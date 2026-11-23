import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { validateInitData, verifyToken, type TokenPayload } from './auth.ts';
import { parseAmount } from './amount.ts';
import type { Bot } from './bot.ts';
import type { Config } from './config.ts';
import { HttpError, type Till } from './service.ts';

export interface Req { method: string; path: string; query: URLSearchParams; headers: Record<string, string | undefined>; body: Buffer }
export interface Res { status: number; headers: Record<string, string>; body: string | Buffer }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-tg-init-data',
  'access-control-max-age': '86400',
};
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const json = (status: number, data: unknown): Res =>
  ({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(data) });

export interface ApiDeps { svc: Till; bot: Bot; cfg: Config; fetchImpl?: typeof fetch }

export function createApi(d: ApiDeps) {
  const { svc, bot, cfg } = d;
  const doFetch = d.fetchImpl ?? fetch;

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
    if (!t || t.k !== kind) throw new HttpError(401, 'bad token');
    const init = validateInitData(r.headers['x-tg-init-data'] ?? '', cfg.botToken);
    if (!init || init.user.id !== t.chat) throw new HttpError(401, 'bad initData');
    return t;
  }

  async function stt(r: Req): Promise<Res> {
    str(r.query.get('deviceId'), 'deviceId');
    if (!cfg.groqKey) throw new HttpError(501, 'stt not configured');
    if (!r.body.length || r.body.length > 3_000_000) throw new HttpError(400, 'bad audio');
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(r.body)], { type: 'audio/wav' }), 'audio.wav');
    form.set('model', 'whisper-large-v3-turbo');
    form.set('language', 'en');
    form.set('response_format', 'json');
    const res = await doFetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: `Bearer ${cfg.groqKey}` }, body: form,
    });
    if (!res.ok) throw new HttpError(502, `stt upstream ${res.status}`);
    const j: any = await res.json();
    const text = String(j.text ?? '').trim();
    const p = parseAmount(text);
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
        case 'GET /tonconnect-manifest.json':
          return json(200, { url: cfg.publicUrl, name: 'ShopTill', iconUrl: `${cfg.publicUrl}/icon.png` });
        case 'POST /api/device/pair': return json(200, svc.pair(str(body(r).deviceId, 'deviceId')));
        case 'POST /api/till/arm': {
          const b = body(r);
          return json(200, svc.arm(str(b.deviceId, 'deviceId'), str(b.amount, 'amount'), str(b.asset, 'asset')));
        }
        case 'GET /api/till/status': return json(200, svc.status(str(r.query.get('deviceId'), 'deviceId')));
        case 'POST /api/till/void': {
          const b = body(r);
          svc.void(str(b.deviceId, 'deviceId'), str(b.saleId, 'saleId'));
          return json(200, { ok: true });
        }
        case 'POST /api/till/receipt': {
          const b = body(r);
          return json(200, { ok: true, ...(await svc.receipt(str(b.deviceId, 'deviceId'), str(b.saleId, 'saleId'))) });
        }
        case 'POST /api/till/attach': {
          const b = body(r);
          svc.attach(str(b.deviceId, 'deviceId'), str(b.saleId, 'saleId'), str(b.paymentId, 'paymentId'));
          return json(200, { ok: true });
        }
        case 'GET /api/today': return json(200, svc.today(str(r.query.get('deviceId'), 'deviceId')));
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
          const address = await svc.jettonWallet(ref, str(r.query.get('owner'), 'owner'));
          if (!address) throw new HttpError(404, 'no jetton wallet for this account');
          return json(200, { address });
        }
        case 'POST /api/shop/address': {
          const b = body(r);
          const t = authMini(r, 'setup', str(b.t, 't'));
          svc.setShopAddress(t.shop!, str(b.address, 'address'));
          void bot.finishSetup(t.shop!).catch((e) => console.log(`finishSetup error: ${(e as Error).message}`));
          return json(200, { ok: true });
        }
      }
      if (r.method === 'GET' && (r.path.startsWith('/pay') || r.path === '/icon.png')) return serveStatic(r.path);
      return json(404, { error: 'not found' });
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.log(`api error ${r.method} ${r.path}: ${(e as Error).message}`);
      return json(500, { error: 'internal error' });
    }
  };
}
