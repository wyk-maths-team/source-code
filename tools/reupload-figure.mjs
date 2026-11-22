// 重传 MO23HI10 为 -2.jpg（绕开 jsDelivr 对该路径的 404），并改写 statement 里的 URL
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { uploadNumberedImage } from '../lib/github-upload.js';

const id = process.argv[2] || 'MO23HI10';
const file = path.join('temp/ha-figures', `${id}-1.jpg`);
const dataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');

const url = await uploadNumberedImage(dataUrl, { folder: 'images/problems', baseName: id });
console.log('新 URL:', url);

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 30000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'wyk_math');
const p = await db.collection('problems').findOne({ id }, { projection: { statement: 1 } });
const st = String(p.statement || '');
const oldUrl = `https://cdn.jsdelivr.net/gh/wyk-math-team/static@main/images/problems/${id}-1.jpg`;
const st2 = st.split(oldUrl).join(url);
console.log('替换次数:', st.split(oldUrl).length - 1);
await db.collection('problems').updateOne({ id }, { $set: { statement: st2 } });
console.log('已更新', id, 'statement');
await client.close();
