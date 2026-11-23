// Dev helper: move test GRAM between the two throwaway testnet wallets.
import { internal, SendMode, toNano } from '@ton/core';
import { client, loadWallet, retry } from './common.ts';
const [from, to, amt] = [process.argv[2] as 'merchant' | 'customer', process.argv[3] as 'merchant' | 'customer', process.argv[4] ?? '0.5'];
const c = client(); const a = await loadWallet(from); const b = await loadWallet(to);
const w = c.open(a.contract);
const seqno = await retry(() => w.getSeqno()).catch(() => 0);
await w.sendTransfer({ seqno, secretKey: a.kp.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
  messages: [internal({ to: b.address, value: toNano(amt), bounce: false })] });
console.log(`sent ${amt} GRAM ${from} -> ${to}`);
