import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TgUser { id: number; first_name?: string; username?: string }

/** Standard Telegram WebApp initData validation. Returns the user, or null if invalid/stale. */
export function validateInitData(
  initData: string, botToken: string, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = 86400,
): { user: TgUser; authDate: number } | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secret).update(dcs).digest();
  const given = Buffer.from(hash, 'hex');
  if (calc.length !== given.length || !timingSafeEqual(calc, given)) return null;
  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return null;
  try {
    const user = JSON.parse(params.get('user') ?? '');
    if (typeof user?.id !== 'number') return null;
    return { user, authDate };
  } catch {
    return null;
  }
}

/** Test/dev helper: build valid initData. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dcs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const b64u = (b: Buffer) => b.toString('base64url');

export interface TokenPayload { k: 'pay' | 'setup'; chat: number; exp: number; ref?: string; shop?: number }

/** Signed, expiring token embedded in the Mini App URL (HMAC key derived from the bot token). */
export function signToken(p: TokenPayload, botToken: string): string {
  const body = b64u(Buffer.from(JSON.stringify(p)));
  const key = createHmac('sha256', 'shoptill-token').update(botToken).digest();
  return `${body}.${b64u(createHmac('sha256', key).update(body).digest())}`;
}

export function verifyToken(t: string, botToken: string, nowSec = Math.floor(Date.now() / 1000)): TokenPayload | null {
  if (!t || !botToken) return null;
  const [body, sig] = t.split('.');
  if (!body || !sig) return null;
  const key = createHmac('sha256', 'shoptill-token').update(botToken).digest();
  const calc = createHmac('sha256', key).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (calc.length !== given.length || !timingSafeEqual(calc, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof p.exp !== 'number' || p.exp < nowSec) return null;
    return p;
  } catch {
    return null;
  }
}
