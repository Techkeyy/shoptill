import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface JettonCfg { master: string; decimals: number }

export interface Config {
  botToken: string;
  groqKey: string;
  tonKey: string;
  publicUrl: string;
  port: number;
  network: 'testnet' | 'mainnet';
  dbPath: string;
  payDir: string;
  /** the one allowlisted USDT-like jetton (undefined = GRAM only) */
  usdt?: JettonCfg;
  /** every allowlisted jetton master */
  jettonMasters: string[];
  jettonDecimals: Record<string, number>;
}

/** Minimal .env parser (KEY=VALUE, # comments, optional quotes). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}

/** Tolerant reader for packages/core/testnet.config.json (shape may evolve). */
export function readJettonConfig(json: any): { usdt?: JettonCfg; masters: string[]; decimals: Record<string, number> } {
  const masters: string[] = [];
  const decimals: Record<string, number> = {};
  let usdt: JettonCfg | undefined;
  const add = (m: unknown, d: unknown) => {
    if (typeof m !== 'string' || !m) return undefined;
    const dec = typeof d === 'number' ? d : 6;
    if (!masters.includes(m)) masters.push(m);
    decimals[m] = dec;
    return { master: m, decimals: dec };
  };
  if (!json || typeof json !== 'object') return { masters, decimals };
  const cand = json.allowlistedJettonMaster ?? json.usdt ?? json.USDT ?? json.jettons?.USDT ?? json.jettons?.usdt ?? json.allowlisted ?? json.good;
  if (cand && typeof cand === 'object') usdt = add(cand.master ?? cand.address ?? cand.jettonMaster, cand.decimals);
  else if (typeof cand === 'string') usdt = add(cand, json.decimals);
  for (const m of json.allowlist?.jettonMasters ?? json.jettonMasters ?? []) add(m, json.decimals);
  if (!usdt && masters.length) usdt = { master: masters[0]!, decimals: decimals[masters[0]!] ?? 6 };
  return { usdt, masters, decimals };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const here = dirname(fileURLToPath(import.meta.url));
  let jc: ReturnType<typeof readJettonConfig> = { masters: [], decimals: {} };
  for (const p of [env.JETTON_CONFIG, resolve(here, '../../packages/core/testnet.config.json'),
    resolve(process.cwd(), 'testnet.config.json'), resolve(process.cwd(), '../packages/core/testnet.config.json')]) {
    if (p && existsSync(p)) {
      try { jc = readJettonConfig(JSON.parse(readFileSync(p, 'utf8'))); break; } catch { /* ignore */ }
    }
  }
  const payCandidates = [env.PAY_DIR, resolve(process.cwd(), 'pay'), resolve(here, '../pay'), resolve(here, '../../apps/pay/dist'),
    resolve(process.cwd(), '../apps/pay/dist')];
  const payDir = payCandidates.find((p) => p && existsSync(p)) ?? resolve(process.cwd(), 'pay');
  return {
    botToken: env.TELEGRAM_BOT_TOKEN ?? '',
    groqKey: env.GROQ_API_KEY ?? '',
    tonKey: env.TONCENTER_API_KEY ?? '',
    publicUrl: (env.PUBLIC_URL ?? 'https://shoptill.103-195-188-198.sslip.io').replace(/\/+$/, ''),
    port: Number(env.PORT ?? 8799),
    network: env.NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
    dbPath: env.DB_PATH ?? 'shoptill.db',
    payDir,
    usdt: jc.usdt,
    jettonMasters: jc.masters,
    jettonDecimals: jc.decimals,
  };
}
