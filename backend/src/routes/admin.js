import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware, requireRole('admin'));

router.get('/users', (req, res) => {
  const users = db
    .prepare("SELECT id, email, name, role, phone, face_embedding, created_at FROM users WHERE role = 'sales'")
    .all()
    .map((u) => ({ ...u, hasFaceEnrolled: !!u.face_embedding, face_embedding: undefined }));
  res.json(users);
});

router.post('/users', async (req, res) => {
  const bcrypt = (await import('bcryptjs')).default;
  const { email, password, name, phone } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email exists' });

  const id = uuid();
  const password_hash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO users (id, email, password_hash, name, role, phone) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, email, password_hash, name, 'sales', phone || null
  );

  res.status(201).json({ id, email, name, role: 'sales', phone });
});

router.get('/locations', (req, res) => {
  const locations = db.prepare(`
    SELECT l.*, u.name as assigned_to_name
    FROM locations l
    LEFT JOIN users u ON l.assigned_to = u.id
    ORDER BY l.created_at DESC
  `).all();
  res.json(locations);
});

router.post('/locations', (req, res) => {
  const { name, address, latitude, longitude, radius_meters, assigned_to } = req.body;
  if (!name || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Name, latitude, and longitude required' });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO locations (id, name, address, latitude, longitude, radius_meters, assigned_to, assigned_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, address || null, latitude, longitude,
    radius_meters || 100, assigned_to || null, req.user.id
  );

  res.status(201).json({ id, name, address, latitude, longitude, radius_meters: radius_meters || 100, assigned_to });
});

router.put('/locations/:id', (req, res) => {
  const { name, address, latitude, longitude, radius_meters, assigned_to, active } = req.body;
  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!loc) return res.status(404).json({ error: 'Location not found' });

  db.prepare(`
    UPDATE locations SET
      name = COALESCE(?, name),
      address = COALESCE(?, address),
      latitude = COALESCE(?, latitude),
      longitude = COALESCE(?, longitude),
      radius_meters = COALESCE(?, radius_meters),
      assigned_to = COALESCE(?, assigned_to),
      active = COALESCE(?, active)
    WHERE id = ?
  `).run(name, address, latitude, longitude, radius_meters, assigned_to, active, req.params.id);

  res.json({ success: true });
});

router.delete('/locations/:id', (req, res) => {
  db.prepare('UPDATE locations SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/attendance', (req, res) => {
  const records = db.prepare(`
    SELECT a.*,
      u.name as user_name,
      l.name as location_name,
      l.latitude as assigned_latitude,
      l.longitude as assigned_longitude,
      l.radius_meters
    FROM attendance a
    JOIN users u ON a.user_id = u.id
    JOIN locations l ON a.location_id = l.id
    ORDER BY a.checked_in_at DESC
    LIMIT 200
  `).all();
  res.json(records);
});

router.get('/dashboard', (req, res) => {
  const totalSales = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'sales'").get().c;
  const todayAttendance = db.prepare(`
    SELECT COUNT(*) as c FROM attendance WHERE date(checked_in_at) = date('now')
  `).get().c;
  const pendingFollowUps = db.prepare(`
    SELECT COUNT(*) as c FROM attendance WHERE follow_up_status = 'pending' AND follow_up_due_at <= datetime('now')
  `).get().c;
  const failedFollowUps = db.prepare(`
    SELECT COUNT(*) as c FROM attendance WHERE follow_up_status = 'failed'
  `).get().c;

  const leadsByStage = db.prepare(`
    SELECT stage, COUNT(*) as count, COALESCE(SUM(value), 0) as total_value
    FROM leads GROUP BY stage
  `).all();

  const totalLeads = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
  const wonLeads = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(value),0) as v FROM leads WHERE stage = 'won'").get();
  const lostLeads = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage = 'lost'").get().c;
  const pipelineValue = db.prepare("SELECT COALESCE(SUM(value),0) as v FROM leads WHERE stage NOT IN ('won','lost')").get().v;

  const conversionRate = totalLeads > 0 ? ((wonLeads.c / totalLeads) * 100).toFixed(1) : 0;

  const recentLeads = db.prepare(`
    SELECT l.*, u.name as assigned_to_name
    FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
    ORDER BY l.updated_at DESC LIMIT 10
  `).all();

  const salesPerformance = db.prepare(`
    SELECT u.id, u.name,
      (SELECT COUNT(*) FROM attendance a WHERE a.user_id = u.id AND date(a.checked_in_at) = date('now')) as today_checkins,
      (SELECT COUNT(*) FROM leads le WHERE le.assigned_to = u.id AND le.stage = 'won') as won_deals,
      (SELECT COUNT(*) FROM leads le WHERE le.assigned_to = u.id) as total_leads
    FROM users u WHERE u.role = 'sales'
  `).all();

  const formSubmissions = db.prepare('SELECT COUNT(*) as c FROM form_submissions').get().c;

  res.json({
    summary: {
      totalSalesPeople: totalSales,
      todayAttendance,
      pendingFollowUps,
      failedFollowUps,
      totalLeads,
      wonDeals: wonLeads.c,
      lostDeals: lostLeads,
      pipelineValue,
      conversionRate: parseFloat(conversionRate),
      wonRevenue: wonLeads.v,
      formSubmissions,
    },
    funnel: leadsByStage,
    recentLeads,
    salesPerformance,
  });
});

export default router;
