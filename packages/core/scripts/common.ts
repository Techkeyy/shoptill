import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Address } from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { TonClient, WalletContractV5R1 } from '@ton/ton';
import axios from 'axios';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../../..');
export const SECRETS = resolve(ROOT, '.secrets');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Throttle every HTTP call (public TON Center allows ~1 rps) and retry 429s at the
// HTTP layer, so a rate-limited sendBoc is retried instead of failing the script.
let lastCall = 0;
const GAP = process.env.TONCENTER_API_KEY ? 150 : 1300;
const baseAdapter = axios.getAdapter(axios.defaults.adapter);
const throttled = async (config: any): Promise<any> => {
  for (let i = 0; ; i++) {
    const wait = lastCall + GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try { return await baseAdapter(config); } catch (e: any) {
      if (e?.response?.status !== 429 || i >= 10) throw e;
      await sleep(2000);
    }
  }
};

export function client() {
  return new TonClient({
    endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY,
    httpAdapter: throttled as any,
  });
}

/** retry on 429 / transient errors (public endpoint is ~1 rps) */
export async function retry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try { await sleep(1100); return await fn(); } catch (e: any) {
      if (i >= tries) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

export function walletFromKey(publicKey: Buffer) {
  return WalletContractV5R1.create({ publicKey, workchain: 0, walletId: { networkGlobalId: -3 } });
}

export async function loadWallet(role: 'merchant' | 'customer') {
  const f = resolve(SECRETS, 'testnet-wallets.json');
  if (!existsSync(f)) throw new Error('run spike:wallets first');
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const kp = await mnemonicToPrivateKey(j[role].mnemonic);
  const contract = walletFromKey(kp.publicKey);
  return { kp, contract, address: contract.address as Address };
}

export const friendly = (a: Address, bounceable = false) => a.toString({ testOnly: true, bounceable });
export const readSecretJson = (n: string) => JSON.parse(readFileSync(resolve(SECRETS, n), 'utf8'));
