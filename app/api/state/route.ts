import { NextResponse } from 'next/server';
import { redisEnabled, redisGet, redisSet, redisSetAdd } from '@/lib/redis';
import { WORKSPACE_INDEX, safeWorkspace, stateKey } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/** กัน payload บวมจากการยิงมั่ว — state จริงของผู้ใช้หนักไม่ถึงหลักร้อย KB */
const MAX_BYTES = 512 * 1024;

export async function GET(request: Request) {
  const workspace = safeWorkspace(new URL(request.url).searchParams.get('w'));
  if (!redisEnabled) {
    return NextResponse.json({ state: null, storage: 'local' });
  }

  try {
    const raw = await redisGet(stateKey(workspace));
    return NextResponse.json(
      { state: raw ? JSON.parse(raw) : null, storage: 'redis' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { state: null, storage: 'error', error: err instanceof Error ? err.message : 'อ่านไม่สำเร็จ' },
      { status: 502 },
    );
  }
}

export async function PUT(request: Request) {
  const workspace = safeWorkspace(new URL(request.url).searchParams.get('w'));
  if (!redisEnabled) {
    return NextResponse.json({ ok: false, storage: 'local' });
  }

  const body = await request.text();
  if (body.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'ข้อมูลใหญ่เกินกำหนด' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, error: 'body ไม่ใช่ JSON' }, { status: 400 });
  }
  if (typeof parsed !== 'object' || parsed === null || !('lists' in parsed)) {
    return NextResponse.json({ ok: false, error: 'รูปแบบ state ไม่ถูกต้อง' }, { status: 400 });
  }

  try {
    /**
     * รวมกับของเดิมแทนการเขียนทับทั้งก้อน
     *
     * ถ้าเขียนทับ แท็บที่เปิดค้างบนเครื่องหนึ่งจะลบงานที่เพิ่งทำบนอีกเครื่องทิ้ง
     * (เจอจริงตอนทดสอบ: แท็บเก่า sync ขึ้นแล้วลิสต์ที่เพิ่งบันทึกจากเครื่องอื่นหายหมด)
     * ข้อมูลชุดนี้แยกเป็นคีย์ตามวัน/ตามหุ้นอยู่แล้ว จึงรวมทีละคีย์ได้ตรงไปตรงมา
     * ชนกันเฉพาะคีย์เดียวกันจริง ๆ ซึ่งให้ของที่ส่งมาใหม่ชนะ
     */
    const previousRaw = await redisGet(stateKey(workspace));
    const incoming = parsed as Record<string, Record<string, unknown>>;
    let merged = incoming;

    if (previousRaw) {
      try {
        const previous = JSON.parse(previousRaw) as Record<string, Record<string, unknown>>;
        merged = {
          ...previous,
          ...incoming,
          lists: { ...(previous.lists ?? {}), ...(incoming.lists ?? {}) },
          snapshots: { ...(previous.snapshots ?? {}), ...(incoming.snapshots ?? {}) },
          journal: { ...(previous.journal ?? {}), ...(incoming.journal ?? {}) },
        };
      } catch {
        // ของเดิมเสียหาย ใช้ของใหม่ไปเลย
      }
    }

    await redisSet(stateKey(workspace), JSON.stringify(merged));
    // เก็บรายชื่อ workspace ไว้ให้ cron แจ้งเตือนวนตรวจได้ในอนาคต
    await redisSetAdd(WORKSPACE_INDEX, workspace);
    return NextResponse.json({ ok: true, storage: 'redis', merged: Boolean(previousRaw) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ' },
      { status: 502 },
    );
  }
}
