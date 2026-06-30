import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import db from './db.js';

const adminId = uuid();
const salesIds = [uuid(), uuid()];

const password_hash = await bcrypt.hash('admin123', 10);
const salesHash = await bcrypt.hash('sales123', 10);

db.prepare('DELETE FROM form_submissions').run();
db.prepare('DELETE FROM attendance').run();
db.prepare('DELETE FROM forms').run();
db.prepare('DELETE FROM leads').run();
db.prepare('DELETE FROM locations').run();
db.prepare('DELETE FROM users').run();

db.prepare('INSERT INTO users (id, email, password_hash, name, role, phone) VALUES (?, ?, ?, ?, ?, ?)').run(
  adminId, 'admin@company.com', password_hash, 'Admin User', 'admin', '9999999999'
);

db.prepare('INSERT INTO users (id, email, password_hash, name, role, phone) VALUES (?, ?, ?, ?, ?, ?)').run(
  salesIds[0], 'john@company.com', salesHash, 'John Sales', 'sales', '9876543210'
);
db.prepare('INSERT INTO users (id, email, password_hash, name, role, phone) VALUES (?, ?, ?, ?, ?, ?)').run(
  salesIds[1], 'jane@company.com', salesHash, 'Jane Sales', 'sales', '9876543211'
);

const locId = uuid();
db.prepare(`
  INSERT INTO locations (id, name, address, latitude, longitude, radius_meters, assigned_to, assigned_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  locId, 'Mumbai Office', 'Bandra Kurla Complex, Mumbai',
  19.0596, 72.8295, 100, salesIds[0], adminId
);

const formId = uuid();
db.prepare('INSERT INTO forms (id, title, description, fields, created_by) VALUES (?, ?, ?, ?, ?)').run(
  formId,
  'Daily Visit Report',
  'Fill after each client visit',
  JSON.stringify([
    { id: 'client_name', label: 'Client Name', type: 'text', required: true },
    { id: 'visit_purpose', label: 'Visit Purpose', type: 'select', options: ['Demo', 'Follow-up', 'Closing', 'Support'], required: true },
    { id: 'outcome', label: 'Outcome', type: 'textarea', required: true },
    { id: 'next_action', label: 'Next Action', type: 'text', required: false },
  ]),
  adminId
);

const leadStages = ['prospect', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const leadNames = [
  ['Acme Corp', 'qualified', 50000],
  ['Beta Industries', 'proposal', 120000],
  ['Gamma Ltd', 'won', 80000],
  ['Delta Solutions', 'prospect', 30000],
  ['Epsilon Tech', 'negotiation', 200000],
  ['Zeta Systems', 'lost', 45000],
];

for (const [name, stage, value] of leadNames) {
  db.prepare(`
    INSERT INTO leads (id, name, email, phone, company, source, stage, value, assigned_to, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuid(), name, `${name.toLowerCase().replace(' ', '')}@email.com`, '9000000000',
    name, 'Field Visit', stage, value, salesIds[Math.floor(Math.random() * 2)], adminId
  );
}

console.log('Database seeded successfully!');
console.log('');
console.log('Demo accounts:');
console.log('  Admin: admin@company.com / admin123');
console.log('  Sales: john@company.com / sales123');
console.log('  Sales: jane@company.com / sales123');
