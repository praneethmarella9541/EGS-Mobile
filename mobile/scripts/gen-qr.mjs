import QRCode from 'qrcode';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getLocalIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '192.168.1.16';
}

function fetchManifestUrl() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:8081', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const match = data.match(/exp:\/\/[^\s"'<>]+/);
        if (match) resolve(match[0]);
        else reject(new Error('No exp:// URL in manifest'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  const ip = getLocalIp();
  let url;

  try {
    url = await fetchManifestUrl();
    console.log('Got URL from Metro manifest');
  } catch {
    // LAN is more reliable than tunnel (avoids ERR_NGROK_3200)
    url = `exp://${ip}:8081`;
    console.log('Using LAN URL (recommended - same WiFi required)');
  }

  const outPath = path.join(__dirname, 'expo-qr.png');
  await QRCode.toFile(outPath, url, { width: 400, margin: 2 });
  console.log('Expo URL:', url);
  console.log('QR saved to:', outPath);
}

main().catch(console.error);
