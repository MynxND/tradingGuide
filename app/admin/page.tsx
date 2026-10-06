'use client';

import { FormEvent, useEffect, useState } from 'react';

type Key = { hash: string; label: string; createdAt: number; status: 'active' | 'revoked'; redeemedAt: number | null };
const formatDate = (value: number | null) => value ? new Date(value).toLocaleString('th-TH') : 'ยังไม่ใช้';

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('');
  const [keys, setKeys] = useState<Key[]>([]);
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const res = await fetch('/api/admin/keys', { cache: 'no-store' });
    if (!res.ok) { setLoggedIn(false); return; }
    setKeys((await res.json() as { keys: Key[] }).keys);
  };
  useEffect(() => { void fetch('/api/admin/session').then((r) => r.json()).then((v: { authenticated: boolean }) => { setLoggedIn(v.authenticated); setReady(true); if (v.authenticated) void load(); }).catch(() => setReady(true)); }, []);

  async function login(event: FormEvent) {
    event.preventDefault(); setError('');
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: secret }) });
    if (!res.ok) { setError((await res.json() as { error?: string }).error ?? 'เข้าสู่ระบบไม่สำเร็จ'); return; }
    setSecret(''); setLoggedIn(true); void load();
  }
  async function create(event: FormEvent) {
    event.preventDefault(); setError(''); setNewKey('');
    const res = await fetch('/api/admin/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) });
    const body = await res.json() as { key?: string; error?: string };
    if (!res.ok) { setError(body.error ?? 'สร้างคีย์ไม่สำเร็จ'); return; }
    setLabel(''); setNewKey(body.key ?? ''); void load();
  }
  async function changeStatus(hash: string, status: Key['status']) {
    const res = await fetch(`/api/admin/keys/${hash}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (!res.ok) setError('เปลี่ยนสถานะไม่สำเร็จ'); else void load();
  }

  if (!ready) return <main className="grid min-h-dvh place-items-center text-ink-dim">กำลังโหลด…</main>;
  if (!loggedIn) return <main className="grid min-h-dvh place-items-center p-5"><form onSubmit={login} className="panel w-full max-w-md space-y-5 p-7"><p className="col-head">Trading Guide</p><h1 className="text-xl font-semibold text-ink-bright">Admin</h1><input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" autoFocus className="w-full rounded border border-line-strong bg-panel-alt px-3 py-2.5 outline-none focus:border-accent" placeholder="Admin access key" required />{error && <p role="alert" className="text-sm text-down">{error}</p>}<button className="w-full rounded bg-accent py-2.5 text-white">เข้าสู่ระบบ</button></form></main>;

  return <main className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8"><header><p className="col-head">Administration</p><h1 className="mt-1 text-2xl font-semibold text-ink-bright">จัดการ Access Key</h1></header>
    <section className="panel space-y-4 p-5"><h2 className="font-medium text-ink-bright">สร้างคีย์ใหม่</h2><form onSubmit={create} className="flex flex-col gap-3 sm:flex-row"><input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} className="min-w-0 flex-1 rounded border border-line-strong bg-panel-alt px-3 py-2 outline-none focus:border-accent" placeholder="ชื่อผู้รับ / หมายเหตุ (ไม่บังคับ)" /><button className="rounded bg-accent px-5 py-2 font-medium text-white">สร้างคีย์</button></form>{newKey && <div className="rounded border border-up/40 bg-up/10 p-4"><p className="mb-2 text-sm text-up">คัดลอกคีย์นี้และส่งให้ผู้รับทันที — จะไม่แสดงอีกครั้ง</p><code className="block break-all select-all rounded bg-bg p-3 text-sm text-ink-bright">{newKey}</code></div>}{error && <p role="alert" className="text-sm text-down">{error}</p>}</section>
    <section className="panel overflow-hidden"><div className="border-b border-line p-5"><h2 className="font-medium text-ink-bright">คีย์ที่สร้างแล้ว ({keys.length})</h2></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-panel-alt text-ink-dim"><tr><th className="p-3 font-medium">หมายเหตุ</th><th className="p-3 font-medium">สร้างเมื่อ</th><th className="p-3 font-medium">เปิดใช้เมื่อ</th><th className="p-3 font-medium">สถานะ</th><th className="p-3" /></tr></thead><tbody>{keys.map((key) => <tr key={key.hash} className="border-t border-line"><td className="p-3">{key.label || '—'}</td><td className="p-3 whitespace-nowrap text-ink-dim">{formatDate(key.createdAt)}</td><td className="p-3 whitespace-nowrap text-ink-dim">{formatDate(key.redeemedAt)}</td><td className="p-3"><span className={key.status === 'active' ? 'text-up' : 'text-down'}>{key.status === 'active' ? 'ใช้งานได้' : 'ปิดแล้ว'}</span></td><td className="p-3">{key.status === 'active' ? <button onClick={() => void changeStatus(key.hash, 'revoked')} className="rounded border border-down/50 px-3 py-1 text-down">ปิดคีย์</button> : <button onClick={() => void changeStatus(key.hash, 'active')} className="rounded border border-up/50 px-3 py-1 text-up">เปิดอีกครั้ง</button>}</td></tr>)}{keys.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-ink-dim">ยังไม่มีคีย์ที่สร้างจากหน้านี้</td></tr>}</tbody></table></div></section></main>;
}
