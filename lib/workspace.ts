/**
 * ตัวระบุว่า state ก้อนไหนเป็นของใคร
 *
 * ตั้งค่าได้ด้วย NEXT_PUBLIC_WORKSPACE_ID เพื่อให้แต่ละ deployment แยกข้อมูลกัน
 * หมายเหตุสำคัญ: นี่ "ไม่ใช่" ระบบยืนยันตัวตน ค่านี้ถูกฝังใน JS ที่ส่งไปเบราว์เซอร์
 * ใครเปิดหน้าเว็ปได้ก็อ่านและแก้ข้อมูลก้อนนี้ได้ ถ้าต้องการปิดจริงต้องเพิ่มระบบล็อกอิน
 */
export const WORKSPACE_ID = process.env.NEXT_PUBLIC_WORKSPACE_ID || 'default';

export const stateKey = (workspace: string) => `tg:state:${workspace}`;
export const WORKSPACE_INDEX = 'tg:workspaces';

/** กันคีย์แปลกปลอมที่ส่งมาจาก client */
export function safeWorkspace(raw: string | null | undefined) {
  const v = (raw ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : 'default';
}
