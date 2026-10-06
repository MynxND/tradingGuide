import { createHash, randomBytes } from 'node:crypto';

const amount = Number(process.argv[2] ?? 1);
if (!Number.isInteger(amount) || amount < 1 || amount > 10_000) {
  throw new Error('ระบุจำนวนคีย์เป็นจำนวนเต็ม 1 ถึง 10000 เช่น: pnpm keys:generate 20');
}

const keys = Array.from({ length: amount }, () => `TG_${randomBytes(24).toString('base64url')}`);
const hashes = keys.map((key) => createHash('sha256').update(key).digest('hex'));

console.log('ส่งรายการ KEY ให้ผู้ใช้ทีละคน (คีย์นี้จะแสดงเพียงครั้งเดียว):\n');
console.log(keys.join('\n'));
console.log('\nตั้งค่า AUTH_KEY_HASHES ใน Vercel/.env.local เป็น JSON นี้ (ห้ามใส่ key จริง):\n');
console.log(JSON.stringify(hashes));
