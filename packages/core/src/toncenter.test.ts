import { afterEach, describe, expect, it, vi } from 'vitest';
import { TonCenter } from './toncenter.ts';

const SRC = '0:' + 'A'.repeat(64);
const DST = '0:' + 'B'.repeat(64);

function mockTxs(transactions: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ transactions }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
}

const tx = (description: unknown, inMsg: Record<string, unknown> = {}) => ({
  hash: 'HASH', lt: '100', now: 1_000_100, finality: 'finalized',
  in_msg: { source: SRC, destination: DST, value: '5000000', opcode: null, bounced: false, ...inMsg },
  description,
});

const client = () => new TonCenter({ baseUrl: 'https://toncenter.com/api/v3', minIntervalMs: 0 });

describe('toncenter native "money stayed" rule', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('credited but aborted (uninit wallet, no bounce) counts as success', async () => {
    mockTxs([tx({ aborted: true, credit_ph: { credit: '5000000' }, bounce: null })]);
    const [p] = await client().getIncomingTransactions(DST, 0);
    expect(p!.success).toBe(true);
    expect(p!.amountRaw).toBe('5000000');
  });

  it('bounce phase ok (money sent back) is not success', async () => {
    mockTxs([tx({ aborted: true, credit_ph: { credit: '5000000' }, bounce: { type: 'ok' } })]);
    const [p] = await client().getIncomingTransactions(DST, 0);
    expect(p!.success).toBe(false);
  });
});

describe('toncenter pagination', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads past the first 100-row page (busy wallets)', async () => {
    const ok = { aborted: false, credit_ph: { credit: '1' }, bounce: null };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset') ?? 0);
      const n = offset === 0 ? 100 : offset === 100 ? 5 : 0;
      const transactions = Array.from({ length: n }, (_, i) => ({ ...tx(ok), hash: `H${offset + i}` }));
      return new Response(JSON.stringify({ transactions }), { status: 200 });
    }));
    const ps = await client().getIncomingTransactions(DST, 0);
    expect(ps).toHaveLength(105);
    expect(calls).toHaveLength(2);
  });
});

describe('toncenter includePending', () => {
  afterEach(() => vi.unstubAllGlobals());
  const ok = { aborted: false, credit_ph: { credit: '5000000' }, bounce: null };
  const rows = () => [
    { ...tx(ok), hash: 'FIN' },
    { ...tx(ok), hash: 'PEND', finality: 'pending' },
    { ...tx(ok), hash: 'CONF', finality: 'confirmed' },
  ];

  it('default: non-finalized rows are skipped (unchanged behavior)', async () => {
    mockTxs(rows());
    const ps = await client().getIncomingTransactions(DST, 0);
    expect(ps.map((p) => p.txHash)).toEqual(['FIN']);
    expect(ps[0]!.pending).toBeUndefined();
  });

  it('includePending: non-finalized rows come back flagged pending', async () => {
    mockTxs(rows());
    const ps = await client().getIncomingTransactions(DST, 0, { includePending: true });
    expect(ps.map((p) => [p.txHash, p.pending ?? false])).toEqual([['FIN', false], ['PEND', true], ['CONF', true]]);
  });
});
