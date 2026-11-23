/**
 * demo-send.ts — stage demo payment scenes on TESTNET with the throwaway CUSTOMER test wallet.
 *
 * DEMO ATTACKER / TEST WALLET — testnet only. Hardcoded to the testnet TON Center endpoint.
 *
 * Usage:
 *   npx tsx scripts/demo-send.ts --to <seller address> --amount 12 --token fake|usdt|gram [--ref <ref>] [--no-comment]
 *
 *   --to          seller (merchant) address the payment goes to
 *   --amount      human units (GRAM or USDT-style jetton, 6 decimals)
 *   --token       fake  = look-alike jetton master from .secrets/testnet-jettons.json (fake.master)
 *                 usdt  = allowlisted jetton master from packages/core/testnet.config.json
 *                 gram  = native TON
 *   --ref         sale ref; the comment sent is `st:<ref>`
 *   --no-comment  send without a comment (demonstrates UNMATCHED)
 *   --help        print this usage and exit (sends nothing)
 *
 * Where the ref comes from: refs are minted server-side (server/src/service.ts, createRef) each
 * time the bot sends a customer a pay message (server/src/bot.ts payUrl). The ref is the `ref=`
 * query parameter of that Mini App / pay URL.
 *   - FAKE scene: the attacker copies the `ref=` value from a Pay link and passes it with --ref.
 *   - UNMATCHED scene: use --no-comment (no ref, so the payment cannot be matched to a sale).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Address, beginCell, internal, SendMode, toNano } from '@ton/core';
import { JettonMinter } from '@ton-community/assets-sdk';
import { client, friendly, loadWallet, readSecretJson, retry, ROOT, sleep } from './common.ts';

const USAGE = `Usage:
  npx tsx scripts/demo-send.ts --to <seller address> --amount <n> --token fake|usdt|gram [--ref <ref>] [--no-comment]
  --help prints this text and sends nothing.`;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    if (key === 'no-comment' || key === 'help') { out[key] = true; continue; }
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`missing value for --${key}`);
    out[key] = v;
  }
  return out;
}

/** decimal string -> integer units with the given decimals (no float rounding) */
function parseUnits(s: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount: ${s}`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new Error(`too many decimal places (max ${decimals})`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || process.argv.length <= 2) { console.log(USAGE); return; }

  const to = args.to as string | undefined;
  const amountStr = args.amount as string | undefined;
  const token = args.token as string | undefined;
  const ref = args.ref as string | undefined;
  const noComment = args['no-comment'] === true;
  if (!to || !amountStr || !token) throw new Error('--to, --amount and --token are required\n' + USAGE);
  if (!['fake', 'usdt', 'gram'].includes(token)) throw new Error('--token must be fake, usdt or gram');
  if (ref && noComment) throw new Error('use either --ref or --no-comment, not both');
  if (!ref && !noComment) throw new Error('pass --ref <ref> (or --no-comment for UNMATCHED)');

  const dest = Address.parse(to);
  const cfg = JSON.parse(readFileSync(resolve(ROOT, 'packages/core/testnet.config.json'), 'utf8'));
  const jt = readSecretJson('testnet-jettons.json');
  const master: string | null = token === 'gram' ? null : token === 'fake' ? jt.fake.master : cfg.allowlistedJettonMaster;
  const amount = token === 'gram' ? toNano(amountStr) : parseUnits(amountStr, 6);
  const tokenLabel = token === 'gram' ? 'TON (native)' : token === 'fake' ? `FAKE USDT (${jt.fake.friendly})` : `USDT allowlisted (${cfg.allowlistedJettonMasterFriendly})`;

  const c = client();
  const cust = await loadWallet('customer');
  const opened = c.open(cust.contract);

  console.log('='.repeat(64));
  console.log('DEMO ATTACKER / TEST WALLET — testnet only');
  console.log(`  token:       ${tokenLabel}`);
  console.log(`  amount:      ${amountStr}`);
  console.log(`  destination: ${friendly(dest)}`);
  console.log(`  comment:     ${noComment ? '(none — UNMATCHED)' : `st:${ref}`}`);
  console.log('='.repeat(64));

  const commentCell = (t: string) => beginCell().storeUint(0, 32).storeStringTail(t).endCell();

  let to_: Address;
  let value: bigint;
  let body: any;
  let bounce: boolean;
  if (master === null) {
    // native GRAM: non-bounceable to seller (seller wallet may be uninit)
    to_ = dest;
    value = amount;
    bounce = false;
    body = noComment ? undefined : commentCell(`st:${ref}`);
  } else {
    // jetton transfer from customer's own jetton wallet, 0.1 TON attached
    const minter = c.open(JettonMinter.createFromAddress(Address.parse(master)));
    const jw = await retry(() => minter.getWalletAddress(cust.address));
    to_ = jw;
    value = toNano('0.1');
    bounce = true;
    // forward payload: Either bit 1 + ref = comment cell; bit 0 = empty (no comment)
    const fwd = beginCell().storeUint(0x0f8a7ea5, 32).storeUint(0, 64).storeCoins(amount)
      .storeAddress(dest).storeAddress(cust.address).storeBit(0)
      .storeCoins(toNano('0.01'));
    body = noComment ? fwd.storeBit(0).endCell() : fwd.storeBit(1).storeRef(commentCell(`st:${ref}`)).endCell();
  }

  const seqno = await retry(() => opened.getSeqno());
  await retry(() => opened.sendTransfer({
    seqno, secretKey: cust.kp.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
    messages: [internal({ to: to_, value, bounce, body })],
  }));
  console.log(`sent (seqno ${seqno}), waiting for wallet seqno to advance...`);

  const deadline = Date.now() + 120_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('timeout: seqno did not advance');
    await sleep(3000);
    const now = await retry(() => opened.getSeqno());
    if (now > seqno) { console.log(`confirmed (seqno ${seqno} -> ${now})`); break; }
  }

  console.log(`customer wallet: https://testnet.tonviewer.com/${friendly(cust.address)}`);
}

main().catch((e) => {
  console.error('demo-send failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
