import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Address } from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { TonClient, WalletContractV5R1 } from '@ton/ton';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../../..');
export const SECRETS = resolve(ROOT, '.secrets');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function client() {
  return new TonClient({
    endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY,
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
