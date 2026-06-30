import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import db from '../db.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { isWithinRadius } from '../utils/geo.js';
import { compareFace, MATCH_THRESHOLD } from '../utils/faceApi.js';
import { prepareImageForFaceApi } from '../utils/imagePrep.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware, requireRole('sales'));

router.get('/locations', (req, res) => {
  const locations = db.prepare(`
    SELECT * FROM locations WHERE assigned_to = ? AND active = 1
  `).all(req.user.id);
  res.json(locations);
});

router.get('/attendance/today', (req, res) => {
  const records = db.prepare(`
    SELECT a.*, l.name as location_name
    FROM attendance a
    JOIN locations l ON a.location_id = l.id
    WHERE a.user_id = ? AND date(a.checked_in_at) = date('now')
    ORDER BY a.checked_in_at DESC
  `).all(req.user.id);
  res.json(records);
});

router.get('/attendance/pending-followup', (req, res) => {
  const pending = db.prepare(`
    SELECT a.*, l.name as location_name, l.latitude as loc_lat, l.longitude as loc_lng, l.radius_meters
    FROM attendance a
    JOIN locations l ON a.location_id = l.id
    WHERE a.user_id = ? AND a.follow_up_status = 'pending' AND a.follow_up_due_at <= datetime('now')
    ORDER BY a.follow_up_due_at ASC
  `).all(req.user.id);
  res.json(pending);
});

router.post('/attendance/check-in', upload.single('photo'), async (req, res) => {
  try {
    const { location_id, latitude, longitude } = req.body;
    if (!location_id || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'location_id, latitude, longitude required' });
    }
    if (!req.file) return res.status(400).json({ error: 'Face photo required' });

    const location = db.prepare(`
      SELECT * FROM locations WHERE id = ? AND assigned_to = ? AND active = 1
    `).get(location_id, req.user.id);
    if (!location) return res.status(404).json({ error: 'Location not found or not assigned to you' });

    const user = db.prepare('SELECT face_embedding FROM users WHERE id = ?').get(req.user.id);
    if (!user?.face_embedding) {
      return res.status(400).json({ error: 'Please enroll your face first' });
    }

    const embedding = JSON.parse(user.face_embedding);
    const { buffer, filename } = await prepareImageForFaceApi(req.file.buffer, req.file.originalname);
    const faceResult = await compareFace(buffer, req.user.id, embedding, filename);
    if (!faceResult.matched) {
      const pct = (faceResult.similarity * 100).toFixed(0);
      return res.status(403).json({
        error: faceResult.similarity >= MATCH_THRESHOLD
          ? 'Face verification failed due to a server mismatch. Please try again or re-enroll your face.'
          : `Face did not match (${pct}% similarity, need ${(MATCH_THRESHOLD * 100).toFixed(0)}%+). Please try again.`,
        similarity: faceResult.similarity,
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const geo = isWithinRadius(lat, lng, location.latitude, location.longitude, location.radius_meters);

    if (!geo.within) {
      return res.status(403).json({
        error: 'You are not within the assigned location',
        distance_meters: Math.round(geo.distance),
        allowed_radius: location.radius_meters,
      });
    }

    const existingToday = db.prepare(`
      SELECT id FROM attendance
      WHERE user_id = ? AND location_id = ? AND date(checked_in_at) = date('now')
    `).get(req.user.id, location_id);
    if (existingToday) {
      return res.status(409).json({ error: 'Already checked in at this location today' });
    }

    const minMin = parseInt(process.env.FOLLOW_UP_MIN_MINUTES || '8');
    const maxMin = parseInt(process.env.FOLLOW_UP_MAX_MINUTES || '15');
    const followUpMinutes = minMin + Math.floor(Math.random() * (maxMin - minMin + 1));

    const id = uuid();
    const followUpDue = new Date(Date.now() + followUpMinutes * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO attendance (
        id, user_id, location_id, check_in_lat, check_in_lng, distance_meters,
        face_verified, location_verified, face_similarity, follow_up_due_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
    `).run(id, req.user.id, location_id, lat, lng, geo.distance, faceResult.similarity, followUpDue);

    res.status(201).json({
      id,
      message: 'Attendance marked successfully',
      face_similarity: faceResult.similarity,
      distance_meters: Math.round(geo.distance),
      follow_up_due_in_minutes: followUpMinutes,
      follow_up_due_at: followUpDue,
    });
  } catch (err) {
    const status = /no face detected|invalid photo|too small|invalid image/i.test(err.message) ? 422 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/attendance/:id/follow-up', (req, res) => {
  const { latitude, longitude } = req.body;
  if (latitude == null || longitude == null) {
    return res.status(400).json({ error: 'latitude and longitude required' });
  }

  const record = db.prepare(`
    SELECT a.*, l.latitude as loc_lat, l.longitude as loc_lng, l.radius_meters
    FROM attendance a
    JOIN locations l ON a.location_id = l.id
    WHERE a.id = ? AND a.user_id = ?
  `).get(req.params.id, req.user.id);

  if (!record) return res.status(404).json({ error: 'Attendance record not found' });
  if (record.follow_up_status !== 'pending') {
    return res.status(400).json({ error: 'Follow-up already completed' });
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const geo = isWithinRadius(lat, lng, record.loc_lat, record.loc_lng, record.radius_meters);
  const verified = geo.within ? 1 : 0;
  const status = geo.within ? 'completed' : 'failed';

  db.prepare(`
    UPDATE attendance SET
      follow_up_lat = ?, follow_up_lng = ?, follow_up_distance_meters = ?,
      follow_up_verified = ?, follow_up_status = ?, follow_up_completed_at = datetime('now')
    WHERE id = ?
  `).run(lat, lng, geo.distance, verified, status, req.params.id);

  res.json({
    success: geo.within,
    status,
    distance_meters: Math.round(geo.distance),
    message: geo.within
      ? 'Location verified successfully'
      : 'Location verification failed - possible mock GPS detected',
  });
});

export default router;
