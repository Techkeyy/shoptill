import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { validateInitData, verifyToken, type TokenPayload } from './auth.ts';
import { parseAmount } from './amount.ts';
import type { Bot } from './bot.ts';
import type { Config } from './config.ts';
import { RateLimiter } from './ratelimit.ts';
import { HttpError, type Till } from './service.ts';

export interface Req { ip?: string; method: string; path: string; query: URLSearchParams; headers: Record<string, string | undefined>; body: Buffer }
export interface Res { status: number; headers: Record<string, string>; body: string | Buffer }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-tg-init-data, x-device-secret',
  // tokens ride in the Mini App URL: never leak them via Referer; no MIME sniffing
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'access-control-max-age': '86400',
};
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const json = (status: number, data: unknown): Res =>
  ({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(data) });

export interface ApiDeps { svc: Till; bot: Bot; cfg: Config; fetchImpl?: typeof fetch }

export function createApi(d: ApiDeps) {
  const { svc, bot, cfg } = d;
  const doFetch = d.fetchImpl ?? fetch;
  const pairLimit = new RateLimiter(120, 60_000);
  const sttLimit = new RateLimiter(12, 60_000);
  const sttIpLimit = new RateLimiter(30, 60_000); // many devices from one IP must not drain the STT quota
  /** Every device call must present the device secret issued at first pair. */
  const dev = (r: Req, id: string): string => { svc.authDevice(id, r.headers['x-device-secret']); return id; };

  const body = (r: Req): any => {
    if (!r.body.length) return {};
    try { return JSON.parse(r.body.toString('utf8')); } catch { throw new HttpError(400, 'bad json'); }
  };
  const str = (v: unknown, name: string): string => {
    if (typeof v !== 'string' || !v) throw new HttpError(400, `${name} required`);
    return v;
  };

  /** Mini App auth: valid signed token AND Telegram initData for the same user. */
  function authMini(r: Req, kind: 'pay' | 'setup', token: string): TokenPayload {
    const t = verifyToken(token, cfg.botToken);
    if (!t || t.k !== kind) throw new HttpError(401, kind === 'setup'
      ? 'This link has expired. Go back to the chat and send /wallet for a fresh one.'
      : 'This payment link has expired. Go back to the chat and tap Refresh.');
    const init = validateInitData(r.headers['x-tg-init-data'] ?? '', cfg.botToken);
    if (!init || init.user.id !== t.chat) throw new HttpError(401, 'bad initData');
    return t;
  }

  async function stt(r: Req): Promise<Res> {
    const did = dev(r, str(r.query.get('deviceId'), 'deviceId'));
    if (!sttLimit.hit(did, Date.now()) || !sttIpLimit.hit(r.ip ?? '?', Date.now())) throw new HttpError(429, 'too many requests');
    if (!cfg.groqKey) throw new HttpError(501, 'stt not configured');
    if (!r.body.length || r.body.length > 3_000_000) throw new HttpError(400, 'bad audio');
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(r.body)], { type: 'audio/wav' }), 'audio.wav');
    form.set('model', 'whisper-large-v3-turbo');
    form.set('language', 'en');
    // Bias toward decimal prices: without this, "twelve fifty" came back as "1250"
    // (checked with TTS audio 2026-11-23; with the prompt it returns "12.50").
    form.set('prompt', 'Shop prices: twelve fifty is 12.50, seven twenty-five is 7.25, five is 5, twenty dollars is $20, three gram is 3 gram, zero point one gram is 0.1 gram, half a gram is 0.5 gram.');
    form.set('response_format', 'json');
    const res = await doFetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: `Bearer ${cfg.groqKey}` }, body: form, signal: AbortSignal.timeout(20_000),
    }).catch(() => { throw new HttpError(504, 'stt timeout'); });
    if (!res.ok) throw new HttpError(502, `stt upstream ${res.status}`);
    const j: any = await res.json();
    const text = String(j.text ?? '').trim();
    const p = parseAmount(text);
    // Price words only (no audio kept): lets us see misreads during testing.
    console.log(`stt heard ${JSON.stringify(text.slice(0, 80))} -> ${p.amount ?? 'none'} ${p.asset}`);
    return json(200, { text, amount: p.amount, asset: p.asset });
  }

  function serveStatic(path: string): Res {
    let rel = path.replace(/^\/pay\/?/, '');
    if (path === '/icon.png') rel = 'icon.png';
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = resolve(cfg.payDir, rel);
    if ((file !== cfg.payDir && !file.startsWith(cfg.payDir + sep)) || !existsSync(file) || !statSync(file).isFile()) {
      return { status: 404, headers: { ...CORS, 'content-type': 'text/plain' }, body: 'not found' };
    }
    const hashed = /\/assets\//.test(file.replace(/\\/g, '/'));
    return {
      status: 200,
      headers: { ...CORS, 'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' },
      body: readFileSync(file),
    };
  }

  return async function handle(r: Req): Promise<Res> {
    if (r.method === 'OPTIONS') return { status: 204, headers: CORS, body: '' };
    try {
      const k = `${r.method} ${r.path}`;
      switch (k) {
        case 'GET /healthz': return json(200, { ok: true });
        case 'GET /api/network': return json(200, { network: cfg.network });
        case 'GET /tonconnect-manifest.json':
          return json(200, { url: cfg.publicUrl, name: 'ShopTill', iconUrl: `${cfg.publicUrl}/icon.png` });
        case 'POST /api/device/pair': {
          if (!pairLimit.hit(r.ip ?? '?', Date.now())) throw new HttpError(429, 'too many requests');
          return json(200, svc.pair(str(body(r).deviceId, 'deviceId'), r.headers['x-device-secret']));
        }
        case 'POST /api/till/arm': {
          const b = body(r);
          return json(200, svc.arm(dev(r, str(b.deviceId, 'deviceId')), str(b.amount, 'amount'), str(b.asset, 'asset')));
        }
        case 'GET /api/till/status': return json(200, svc.status(dev(r, str(r.query.get('deviceId'), 'deviceId'))));
        case 'POST /api/till/void': {
          const b = body(r);
          svc.void(dev(r, str(b.deviceId, 'deviceId')), str(b.saleId, 'saleId'));
          return json(200, { ok: true });
        }
        case 'POST /api/till/receipt': {
          const b = body(r);
          return json(200, { ok: true, ...(await svc.receipt(dev(r, str(b.deviceId, 'deviceId')), str(b.saleId, 'saleId'))) });
        }
        case 'POST /api/till/attach': {
          const b = body(r);
          svc.attach(dev(r, str(b.deviceId, 'deviceId')), str(b.saleId, 'saleId'), str(b.paymentId, 'paymentId'));
          return json(200, { ok: true });
        }
        case 'GET /api/today': return json(200, svc.today(dev(r, str(r.query.get('deviceId'), 'deviceId'))));
        case 'POST /api/stt': return await stt(r);
        case 'GET /api/pay/info': {
          const ref = str(r.query.get('ref'), 'ref');
          const t = authMini(r, 'pay', r.query.get('t') ?? '');
          if (t.ref !== ref) throw new HttpError(401, 'token/ref mismatch');
          const info = svc.payInfo(ref);
          if (!info) throw new HttpError(404, 'unknown ref');
          return json(200, info);
        }
        case 'GET /api/pay/jetton-wallet': {
          const ref = str(r.query.get('ref'), 'ref');
          const t = authMini(r, 'pay', r.query.get('t') ?? '');
          if (t.ref !== ref) throw new HttpError(401, 'token/ref mismatch');
          return json(200, await svc.jettonWallet(ref, str(r.query.get('owner'), 'owner')));
        }
        case 'GET /api/pay/balance': {
          const ref = str(r.query.get('ref'), 'ref');
          const t = authMini(r, 'pay', r.query.get('t') ?? '');
          if (t.ref !== ref) throw new HttpError(401, 'token/ref mismatch');
          return json(200, { balance: await svc.accountBalance(ref, str(r.query.get('owner'), 'owner')) });
        }
        case 'POST /api/shop/address': {
          const b = body(r);
          const t = authMini(r, 'setup', str(b.t, 't'));
          // the token must belong to this shop's own seller chat (defence in depth)
          if (!t.shop || svc.shop(t.shop)?.seller_chat !== t.chat) throw new HttpError(401, 'bad setup link');
          svc.setShopAddress(t.shop, str(b.address, 'address'));
          void bot.finishSetup(t.shop!).catch((e) => console.log(`finishSetup error: ${(e as Error).message}`));
          return json(200, { ok: true });
        }
      }
      // The bare domain sends visitors to the public landing page (site/, hosted on Vercel).
      if (r.method === 'GET' && r.path === '/') return { status: 302, headers: { ...CORS, location: 'https://shoptill.vercel.app/' }, body: '' };
      if (r.method === 'GET' && (r.path.startsWith('/pay') || r.path === '/icon.png')) return serveStatic(r.path);
      return json(404, { error: 'not found' });
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.log(`api error ${r.method} ${r.path}: ${(e as Error).message}`);
      return json(500, { error: 'internal error' });
    }
  };
}
