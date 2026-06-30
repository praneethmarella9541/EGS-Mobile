# How to Open the App

**You do NOT need Supabase.** This app uses a local SQLite database on your PC. No cloud database setup is required.

## Step 1: Install Expo Go on your phone

- **Android**: [Google Play - Expo Go](https://play.google.com/store/apps/details?id=host.exp.exponent)
- **iPhone**: [App Store - Expo Go](https://apps.apple.com/app/expo-go/id982107779)

Make sure Expo Go is **updated to the latest version** (supports **SDK 54**).

## Step 2: Start the backend (Terminal 1)

```powershell
cd "c:\Users\Administrator\Downloads\attendance system faial recog\backend"
npm start
```

You should see: `Sales Attendance API running on http://0.0.0.0:3001`

## Step 3: Start Expo (Terminal 2)

```powershell
cd "c:\Users\Administrator\Downloads\attendance system faial recog\mobile"
npx expo start --lan --clear
```

Use **LAN mode** (not tunnel) — avoids ngrok `ERR_NGROK_3200` errors. Phone and PC must be on the **same WiFi**.

If LAN doesn't work, try tunnel as fallback:

```powershell
npx expo start --tunnel --clear
```

## Step 4: Scan the QR code

- **Android**: Open Expo Go → Scan QR code
- **iPhone**: Open Camera app → scan QR → tap the Expo link

QR code file: `mobile/scripts/expo-qr.png`

Or scan the QR shown in the terminal after Expo starts.

## Step 5: Login

| Role  | Email              | Password  |
|-------|--------------------|-----------|
| Admin | admin@company.com  | admin123  |
| Sales | john@company.com   | sales123  |

---

## Troubleshooting

### "Unable to open" or app won't load
1. Run `npx expo start --tunnel --clear` again (fresh QR)
2. Update Expo Go to the latest version
3. Phone and PC must have internet (tunnel mode)

### Login fails / "Network Error"
1. Backend must be running (`npm start` in backend folder)
2. Phone and PC must be on the **same WiFi**
3. Windows Firewall may block port 3001 — allow Node.js when prompted
4. Check API URL on login screen matches your PC IP

### Face / camera not working
- Grant camera and location permissions when prompted
- Enroll face first (Sales → Face ID tab) before check-in

---

## What uses what?

| Service    | Required? | Purpose                          |
|------------|-----------|----------------------------------|
| Supabase   | **No**    | Not used — local SQLite instead  |
| Your PC    | **Yes**   | Runs backend API on port 3001    |
| GCP Face API | **Yes** | Face recognition (already hosted) |
| Expo Go    | **Yes**   | Runs the mobile app for testing  |
