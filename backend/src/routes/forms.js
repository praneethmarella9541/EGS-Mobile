import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// Admin form management
const adminRouter = Router();
adminRouter.use(authMiddleware, requireRole('admin'));

adminRouter.get('/', (req, res) => {
  const forms = db.prepare(`
    SELECT f.*, u.name as created_by_name,
      (SELECT COUNT(*) FROM form_submissions fs WHERE fs.form_id = f.id) as submission_count
    FROM forms f LEFT JOIN users u ON f.created_by = u.id
    ORDER BY f.created_at DESC
  `).all();
  res.json(forms.map((f) => ({ ...f, fields: JSON.parse(f.fields) })));
});

adminRouter.post('/', (req, res) => {
  const { title, description, fields } = req.body;
  if (!title || !fields?.length) {
    return res.status(400).json({ error: 'Title and fields required' });
  }

  const id = uuid();
  db.prepare('INSERT INTO forms (id, title, description, fields, created_by) VALUES (?, ?, ?, ?, ?)').run(
    id, title, description || null, JSON.stringify(fields), req.user.id
  );

  res.status(201).json({ id, title, description, fields });
});

adminRouter.put('/:id', (req, res) => {
  const { title, description, fields, active } = req.body;
  db.prepare(`
    UPDATE forms SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      fields = COALESCE(?, fields),
      active = COALESCE(?, active)
    WHERE id = ?
  `).run(title, description, fields ? JSON.stringify(fields) : null, active, req.params.id);
  res.json({ success: true });
});

adminRouter.get('/:id/submissions', (req, res) => {
  const submissions = db.prepare(`
    SELECT fs.*, u.name as user_name
    FROM form_submissions fs
    JOIN users u ON fs.user_id = u.id
    WHERE fs.form_id = ?
    ORDER BY fs.submitted_at DESC
  `).all(req.params.id);
  res.json(submissions.map((s) => ({ ...s, data: JSON.parse(s.data) })));
});

// Sales form access
const salesRouter = Router();
salesRouter.use(authMiddleware, requireRole('sales'));

salesRouter.get('/', (req, res) => {
  const forms = db.prepare('SELECT id, title, description, fields, created_at FROM forms WHERE active = 1').all();
  res.json(forms.map((f) => ({ ...f, fields: JSON.parse(f.fields) })));
});

salesRouter.post('/:id/submit', (req, res) => {
  const form = db.prepare('SELECT * FROM forms WHERE id = ? AND active = 1').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const id = uuid();
  db.prepare('INSERT INTO form_submissions (id, form_id, user_id, data) VALUES (?, ?, ?, ?)').run(
    id, req.params.id, req.user.id, JSON.stringify(req.body.data || req.body)
  );

  res.status(201).json({ id, message: 'Form submitted successfully' });
});

salesRouter.get('/my-submissions', (req, res) => {
  const submissions = db.prepare(`
    SELECT fs.*, f.title as form_title
    FROM form_submissions fs
    JOIN forms f ON fs.form_id = f.id
    WHERE fs.user_id = ?
    ORDER BY fs.submitted_at DESC
  `).all(req.user.id);
  res.json(submissions.map((s) => ({ ...s, data: JSON.parse(s.data) })));
});

router.use('/admin', adminRouter);
router.use('/sales', salesRouter);

export default router;
