import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();
const STAGES = ['prospect', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

router.use(authMiddleware);

router.get('/', (req, res) => {
  let leads;
  if (req.user.role === 'admin') {
    leads = db.prepare(`
      SELECT l.*, u.name as assigned_to_name, c.name as created_by_name
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN users c ON l.created_by = c.id
      ORDER BY l.updated_at DESC
    `).all();
  } else {
    leads = db.prepare(`
      SELECT l.* FROM leads l WHERE l.assigned_to = ? OR l.created_by = ?
      ORDER BY l.updated_at DESC
    `).all(req.user.id, req.user.id);
  }
  res.json(leads);
});

router.post('/', requireRole('admin', 'sales'), (req, res) => {
  const { name, email, phone, company, source, stage, value, assigned_to, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Lead name required' });

  const id = uuid();
  const leadStage = STAGES.includes(stage) ? stage : 'prospect';
  const assignTo = assigned_to || (req.user.role === 'sales' ? req.user.id : null);

  db.prepare(`
    INSERT INTO leads (id, name, email, phone, company, source, stage, value, assigned_to, created_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, email || null, phone || null, company || null, source || null,
    leadStage, value || 0, assignTo, req.user.id, notes || null
  );

  res.status(201).json({ id, name, stage: leadStage });
});

router.put('/:id', requireRole('admin', 'sales'), (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  if (req.user.role === 'sales' && lead.assigned_to !== req.user.id && lead.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { name, email, phone, company, source, stage, value, assigned_to, notes } = req.body;
  const leadStage = stage && STAGES.includes(stage) ? stage : lead.stage;

  db.prepare(`
    UPDATE leads SET
      name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone),
      company = COALESCE(?, company), source = COALESCE(?, source), stage = ?,
      value = COALESCE(?, value), assigned_to = COALESCE(?, assigned_to),
      notes = COALESCE(?, notes), updated_at = datetime('now')
    WHERE id = ?
  `).run(name, email, phone, company, source, leadStage, value, assigned_to, notes, req.params.id);

  res.json({ success: true, stage: leadStage });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Lead deleted' });
});

router.get('/funnel', requireRole('admin'), (req, res) => {
  const funnel = db.prepare(`
    SELECT stage, COUNT(*) as count, COALESCE(SUM(value), 0) as total_value
    FROM leads GROUP BY stage ORDER BY
      CASE stage
        WHEN 'prospect' THEN 1 WHEN 'qualified' THEN 2 WHEN 'proposal' THEN 3
        WHEN 'negotiation' THEN 4 WHEN 'won' THEN 5 WHEN 'lost' THEN 6
      END
  `).all();

  const monthlyTrend = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as leads_created,
      SUM(CASE WHEN stage = 'won' THEN 1 ELSE 0 END) as won
    FROM leads GROUP BY month ORDER BY month DESC LIMIT 6
  `).all();

  res.json({ funnel, monthlyTrend });
});

export default router;
