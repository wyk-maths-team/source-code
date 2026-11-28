
import crypto from 'node:crypto';
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const cloud = process.env.CLOUDINARY_CLOUD_NAME;
const key = process.env.CLOUDINARY_API_KEY;
const secret = process.env.CLOUDINARY_API_SECRET;

const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'wyk_math');

const users = await db.collection('users').find(
  { pfp: /cdn\.jsdelivr\.net/ },
  { projection: { _id: 0, username: 1, pfp: 1 } }
).toArray();
console.log('to migrate:', users.length);

let ok = 0, fail = 0;
const done = [];
for (const u of users) {
  const url = String(u.pfp);
  const base = url.split('/').pop().split('?')[0].replace(/\.[a-z0-9]+$/i, '');
  const publicId = 'pfp/' + base;
  const timestamp = String(Math.floor(Date.now() / 1000));

  // Cloudinary 要求：所有参与签名的参数按字母序拼接，file / api_key / signature 不参与
  const signed = { overwrite: 'true', public_id: publicId, timestamp };
  const toSign = Object.keys(signed).sort().map(k => k + '=' + signed[k]).join('&') + secret;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  const form = new URLSearchParams();
  form.append('file', url);
  form.append('public_id', publicId);
  form.append('timestamp', timestamp);
  form.append('overwrite', 'true');
  form.append('api_key', key);
  form.append('signature', signature);

  try {
    const r = await fetch('https://api.cloudinary.com/v1_1/' + cloud + '/image/upload', {
      method: 'POST', body: form, signal: AbortSignal.timeout(90000),
    });
    const j = await r.json();
    if (!r.ok || !j.secure_url) {
      console.log('  FAIL ' + u.username.padEnd(12) + r.status + '  ' + (j.error && j.error.message || '').slice(0, 100));
      fail++;
      continue;
    }
    await db.collection('users').updateOne({ username: u.username }, { $set: { pfp: j.secure_url } });
    console.log('  ok   ' + u.username.padEnd(12) + (j.bytes/1024).toFixed(1).padStart(8) + ' KB  ' + j.format + '  ' + j.width + 'x' + j.height);
    done.push({ username: u.username, from: url, to: j.secure_url });
    ok++;
  } catch (e) {
    console.log('  ERR  ' + u.username + '  ' + String(e.message).slice(0, 80));
    fail++;
  }
}
console.log('\nmigrated:', ok, 'failed:', fail);
if (done.length) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync('private/backup_json/pfp-migrated-' + stamp + '.json', JSON.stringify(done, null, 1));
}
await c.close();
