export type LivePrice = {
  symbol: string;
  /** ชื่อบริษัทจาก provider — ใช้ตรวจว่า ticker ตรงตัวที่ต้องการจริง */
  name?: string | null;
  /** ราคาเปิดของ session (09:30 ET) */
  open: number | null;
  /** ราคาซื้อขายล่าสุด */
  last: number | null;
  /** high ของวัน (ข้อมูลเสริม) */
  dayHigh: number | null;
};

export type WindowSnapshot = {
  /** ราคา ณ 11:30 ET */
  end: number | null;
  /** ราคาสูงสุดระหว่าง 09:30–11:30 ET */
  high: number | null;
};

export type LiveResult = {
  prices: Map<string, LivePrice>;
  /** หุ้นที่ส่งไปถาม provider จริงในรอบนี้ */
  attempted: string[];
};

export type Provider = {
  name: string;
  /**
   * จำนวนหุ้นสูงสุดที่ดึงได้ใน 1 รอบรีเฟรช ตามโควตาของ provider
   * ถ้าลิสต์ยาวกว่านี้ ระบบจะหมุนดึงเป็นชุด ๆ ข้ามรอบ
   */
  maxPerCycle: number;
  /** เว้นระยะระหว่างรอบรีเฟรชอย่างน้อยกี่มิลลิวินาที ให้พอดีกับโควตา */
  minCycleMs: number;
  /** จำนวนหุ้นสูงสุดที่โควตายังรีเฟรชได้ทันทุกรอบ เกินกว่านี้ราคาจะหมุนอัปเดตช้าลง */
  capacity: number;
  /** ดึงราคาสด — ต้องบอกด้วยว่ายิงถามตัวไหนไปจริง เพื่อแยก "ไม่มีข้อมูล" ออกจาก "โควตาไม่พอ" */
  fetchLive(symbols: string[]): Promise<LiveResult>;
  /**
   * ข้อมูลของหน้าต่าง 09:30–11:30 ET ของวันซื้อขายล่าสุด
   * high ต้องคิดจากแท่งในช่วงนี้เท่านั้น ไม่ใช่ high ของทั้งวัน
   * เพราะหลัง 11:30 ราคายังวิ่งต่อและจะทำให้ high เพี้ยนจากที่กลยุทธ์สนใจ
   */
  fetchWindowSnapshot(symbol: string): Promise<WindowSnapshot | null>;
  /**
   * ชื่อบริษัทของชื่อย่อ — provider ที่ไม่ส่งชื่อมาพร้อมราคา (เช่น Finnhub)
   * ใช้ตัวนี้เติมให้ ผู้ใช้จะยังเห็นว่า ticker ตรงตัวที่ต้องการไหม
   */
  fetchName?(symbol: string): Promise<string | null>;
};
