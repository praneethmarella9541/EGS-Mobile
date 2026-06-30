import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import db from './db.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import salesRoutes from './routes/sales.js';
import formsRoutes from './routes/forms.js';
import leadsRoutes from './routes/leads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/leads', leadsRoutes);

// Mark missed follow-ups periodically
setInterval(() => {
  db.prepare(`
    UPDATE attendance SET follow_up_status = 'missed'
    WHERE follow_up_status = 'pending'
      AND follow_up_due_at < datetime('now', '-30 minutes')
  `).run();
}, 60000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sales Attendance API running on http://0.0.0.0:${PORT}`);
});
