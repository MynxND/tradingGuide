'use client';

import { FormEvent, useEffect, useState } from 'react';

const BROWSER_ID_KEY = 'tg.browser-id.v1';

function browserId() {
  let id = localStorage.getItem(BROWSER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem(BROWSER_ID_KEY, id);
  }
  return id;
}

/**
 * ใส่ browser proof ทุก request โดยไม่ต้องแก้ fetch แต่ละจุดในแอป
 * ค่าที่ส่งเป็นเพียงตัวผูก session; access key ไม่เคยเก็บใน browser
 */
function installBrowserProof() {
  const original = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('x-tg-browser-id', browserId());
    return original(input, { ...init, headers });
  };
  return () => { window.fetch = original; };
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'login' | 'ready'>('checking');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const remove = installBrowserProof();
    void fetch('/api/auth/session', { cache: 'no-store' })
      .then((res) => res.json())
      .then((body: { authenticated?: boolean }) => setStatus(body.authenticated ? 'ready' : 'login'))
      .catch(() => setStatus('login'));
    return remove;
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, browserId: browserId() }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'เข้าสู่ระบบไม่สำเร็จ');
      setKey('');
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'ready') return <>{children}</>;
  if (status === 'checking') return <main className="grid min-h-dvh place-items-center text-ink-dim">กำลังตรวจสอบสิทธิ์…</main>;

  return (
    <main className="grid min-h-dvh place-items-center p-5">
      <form onSubmit={login} className="panel w-full max-w-md space-y-5 p-7 shadow-2xl" noValidate>
        <div>
          <p className="col-head">Trading Guide</p>
          <h1 className="mt-2 text-xl font-semibold text-ink-bright">เข้าสู่ระบบด้วย Access Key</h1>
          <p className="mt-2 text-sm leading-6 text-ink-dim">คีย์ใช้เปิดใช้งานได้ครั้งเดียวและจะผูกกับเบราว์เซอร์นี้</p>
        </div>
        <label className="block space-y-2 text-sm text-ink">
          <span>Access Key</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} autoComplete="one-time-code" spellCheck={false}
            className="w-full rounded border border-line-strong bg-panel-alt px-3 py-2.5 font-mono text-sm outline-none focus:border-accent"
            placeholder="วางคีย์ที่ได้รับ" required />
        </label>
        {error && <p role="alert" className="rounded border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}
        <button disabled={submitting} className="w-full rounded bg-accent px-4 py-2.5 font-medium text-white disabled:cursor-wait disabled:opacity-60">
          {submitting ? 'กำลังตรวจสอบ…' : 'เปิดใช้งาน'}
        </button>
        <p className="text-xs leading-5 text-ink-dim">ห้ามล้างข้อมูลเว็บไซต์หรือใช้โหมดไม่ระบุตัวตนหลังเปิดใช้งาน หากเปลี่ยนเบราว์เซอร์ ต้องติดต่อผู้ดูแลเพื่อออกคีย์ใหม่</p>
      </form>
    </main>
  );
}
