import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { TonCenter } from '@shoptill/core';
import { createApi } from './api.ts';
import { Bot } from './bot.ts';
import { loadConfig, parseEnv } from './config.ts';
import { openDb } from './db.ts';
import { Till, type Chain } from './service.ts';
import { BotApi } from './telegram.ts';

for (const p of ['.env', 'server/.env']) {
  if (existsSync(p)) {
    for (const [k, v] of Object.entries(parseEnv(readFileSync(p, 'utf8')))) if (process.env[k] === undefined) process.env[k] = v;
    break;
  }
}

const cfg = loadConfig();
if (!cfg.botToken) { console.error('TELEGRAM_BOT_TOKEN is not set'); process.exit(1); }
if (!cfg.groqKey) console.log('warning: GROQ_API_KEY not set, /api/stt disabled');
if (!cfg.usdt) console.log('no allowlisted jetton configured: GRAM only');

const tc = new TonCenter({
  apiKey: cfg.tonKey || undefined,
  baseUrl: cfg.network === 'mainnet' ? 'https://toncenter.com/api/v3' : undefined,
  jettonDecimals: cfg.jettonDecimals,
});
const chain: Chain = {
  // forward opts: the watcher asks for includePending (CONFIRMING); dropping it silently disabled that state
  getIncomingTransactions: (a, s, o) => tc.getIncomingTransactions(a, s, o),
  getJettonTransfersTo: (a, s, o) => tc.getJettonTransfersTo(a, s, o),
  // shares the client's throttle (note: `get` is private in core)
  raw: (path, params) => tc.get(path, params),
};

console.log(`database: ${cfg.dbPath}`);
const db = openDb(cfg.dbPath);
const tg = new BotApi(cfg.botToken);
const svc = new Till({ db, cfg, ton: chain, tg });
const bot = new Bot(svc, tg, cfg);
const handle = createApi({ svc, bot, cfg });

const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 4_000_000) { res.writeHead(413).end(); return; }
      chunks.push(c as Buffer);
    }
    const url = new URL(req.url ?? '/', 'http://x');
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
    // Caddy (the only thing that can reach this socket) sets x-forwarded-for to the real client.
    const ip = (headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() || req.socket.remoteAddress || '?';
    const out = await handle({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers, body: Buffer.concat(chunks), ip });
    res.writeHead(out.status, out.headers).end(out.body);
  } catch (e) {
    // A client that aborts mid-body or sends a malformed URL must not take the process down.
    console.log(`request error: ${(e as Error).message}`);
    if (!res.headersSent) res.writeHead(400).end(); else res.destroy();
  }
});
process.on('unhandledRejection', (e) => console.log(`unhandled rejection: ${(e as Error)?.message ?? e}`));

// Loopback only: Caddy is the public face, and rate limits trust its x-forwarded-for.
server.listen(cfg.port, '127.0.0.1', () => console.log(`shoptill listening on 127.0.0.1:${cfg.port} (${cfg.network})`));

const signal = { stopped: false };
await bot.init();
console.log(`bot @${bot.username} ready`);
svc.start();
void bot.poll(signal);

for (const s of ['SIGINT', 'SIGTERM'] as const) {
  process.on(s, () => { signal.stopped = true; svc.stop(); server.close(); process.exit(0); });
}
