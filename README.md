# Sales Attendance System

Face + GPS verified attendance app for sales teams with admin dashboard, dynamic forms, and lead funnel tracking.

## Features

- **Admin**: Assign locations to sales people, create forms, view attendance logs, leads funnel and metrics
- **Sales**: Face enrollment, GPS-verified check-in (100m radius), anti mock-GPS follow-up verification (8-15 min after check-in)
- **Face API**: InsightFace on GCP (`/embedding`, `/compare`)
- **Forms**: Admin-created forms filled by sales people
- **Leads**: Full sales pipeline (prospect to won/lost) with dashboard metrics

## Quick Start

### 1. Backend

```bash
cd backend
npm install
npm run seed
npm start
```

Runs on http://0.0.0.0:3001

### 2. Mobile (Expo)

```bash
cd mobile
npm install
npx expo start --tunnel
```

Scan the QR code with Expo Go on your phone.

Update `mobile/src/config.ts` with your PC local IP if needed. Phone and PC must be on the same WiFi.

### Demo Accounts

| Role  | Email              | Password  |
|-------|--------------------|-----------|
| Admin | admin@company.com  | admin123  |
| Sales | john@company.com   | sales123  |
| Sales | jane@company.com   | sales123  |

## Attendance Flow

1. Sales person enrolls face (Face ID tab)
2. Admin assigns a location with lat/lng and 100m radius
3. At location, sales taps Check In - GPS captured and face verified via InsightFace
4. 8-15 minutes later, app prompts for follow-up GPS check
5. Admin sees all records and failed follow-ups in dashboard
