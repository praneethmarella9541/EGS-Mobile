import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import db from '../db.js';
import { signToken, authMiddleware } from '../middleware/auth.js';
import { getEmbedding } from '../utils/faceApi.js';
import { prepareImageForFaceApi } from '../utils/imagePrep.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role, phone } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    const userRole = role === 'admin' ? 'admin' : 'sales';
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const id = uuid();
    const password_hash = await bcrypt.hash(password, 10);
    db.prepare(
      'INSERT INTO users (id, email, password_hash, name, role, phone) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, email, password_hash, name, userRole, phone || null);

    const user = { id, email, name, role: userRole };
    res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { password_hash, face_embedding, ...safe } = user;
    res.json({
      user: { ...safe, hasFaceEnrolled: !!face_embedding },
      token: signToken(safe),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, email, name, role, phone, face_embedding, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    ...user,
    hasFaceEnrolled: !!user.face_embedding,
    face_embedding: undefined,
  });
});

router.post('/enroll-face', authMiddleware, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo required' });

    const { buffer, filename } = await prepareImageForFaceApi(req.file.buffer, req.file.originalname);
    const embedding = await getEmbedding(buffer, filename);
    db.prepare('UPDATE users SET face_embedding = ? WHERE id = ?').run(
      JSON.stringify(embedding),
      req.user.id
    );

    res.json({ success: true, message: 'Face enrolled successfully' });
  } catch (err) {
    const status = /no face detected|invalid photo|too small|invalid image/i.test(err.message) ? 422 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
