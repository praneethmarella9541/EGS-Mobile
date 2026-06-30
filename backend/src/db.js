import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'attendance.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'sales')),
    face_embedding TEXT,
    phone TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    radius_meters INTEGER DEFAULT 100,
    assigned_to TEXT REFERENCES users(id),
    assigned_by TEXT REFERENCES users(id),
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    location_id TEXT NOT NULL REFERENCES locations(id),
    check_in_lat REAL NOT NULL,
    check_in_lng REAL NOT NULL,
    distance_meters REAL,
    face_verified INTEGER DEFAULT 0,
    location_verified INTEGER DEFAULT 0,
    face_similarity REAL,
    checked_in_at TEXT DEFAULT (datetime('now')),
    follow_up_due_at TEXT,
    follow_up_lat REAL,
    follow_up_lng REAL,
    follow_up_distance_meters REAL,
    follow_up_verified INTEGER,
    follow_up_status TEXT DEFAULT 'pending' CHECK(follow_up_status IN ('pending', 'completed', 'failed', 'missed')),
    follow_up_completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    fields TEXT NOT NULL,
    created_by TEXT REFERENCES users(id),
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS form_submissions (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES forms(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    data TEXT NOT NULL,
    submitted_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    source TEXT,
    stage TEXT DEFAULT 'prospect' CHECK(stage IN ('prospect', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
    value REAL DEFAULT 0,
    assigned_to TEXT REFERENCES users(id),
    created_by TEXT REFERENCES users(id),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_follow_up ON attendance(follow_up_status, follow_up_due_at);
  CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
  CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);
`);

export default db;
