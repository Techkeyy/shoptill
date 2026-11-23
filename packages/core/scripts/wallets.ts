import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { fromNano } from '@ton/core';
import { client, friendly, retry, SECRETS, walletFromKey, loadWallet } from './common.ts';

mkdirSync(SECRETS, { recursive: true });
const file = resolve(SECRETS, 'testnet-wallets.json');
if (!existsSync(file)) {
  const out: Record<string, unknown> = {};
  for (const role of ['merchant', 'customer']) {
    const mnemonic = await mnemonicNew(24);
    const kp = await mnemonicToPrivateKey(mnemonic);
    const w = walletFromKey(kp.publicKey);
    out[role] = { mnemonic, address: friendly(w.address) };
  }
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('generated new testnet wallets (mnemonics stored in .secrets only)');
}
const c = client();
for (const role of ['merchant', 'customer'] as const) {
  const w = await loadWallet(role);
  const bal = await retry(() => c.getBalance(w.address));
  console.log(`${role.padEnd(9)} ${friendly(w.address)}  raw=${w.address.toRawString()}  balance=${fromNano(bal)} GRAM`);
}
