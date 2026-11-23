import { describe, expect, it } from 'vitest';
import { classify, parseRef } from './match.ts';
import type { Allowlist, IncomingPayment, Sale } from './types.ts';

const hex = (c: string) => '0:' + c.repeat(64);
const GOOD = hex('A');
const FAKE_M = hex('B');
const SELLER_FROM = hex('C');

const AL: Allowlist = { native: true, jettonMasters: [GOOD] };
const T0 = 1_000_000;
const sale = (o: Partial<Sale> = {}): Sale => ({
  ref: 'k7q2', amountRaw: 12_000_000n, asset: { kind: 'jetton', master: GOOD },
  createdAt: T0, expiresAt: T0 + 900, voidedAt: null, ...o,
});
let n = 0;
const pay = (o: Partial<IncomingPayment> = {}): IncomingPayment => ({
  txHash: 'h' + ++n, lt: String(1000 + n), utime: T0 + 30, success: true, from: SELLER_FROM,
  asset: { kind: 'jetton', master: GOOD }, amountRaw: '12000000', decimals: 6,
  comment: 'st:k7q2', ...o,
});
const NOW = T0 + 60;

describe('state machine', () => {
  it('WAITING: nothing received', () => {
    expect(classify(sale(), [], AL, NOW).state).toBe('WAITING');
  });
  it('PAID: exact amount', () => {
    const r = classify(sale(), [pay()], AL, NOW);
    expect(r.state).toBe('PAID');
    expect(r.paidRaw).toBe(12_000_000n);
  });
  it('SHORT: partial, sale stays open, then top-up completes', () => {
    const r = classify(sale(), [pay({ amountRaw: '9000000' })], AL, NOW);
    expect(r.state).toBe('SHORT');
    expect(r.missingRaw).toBe(3_000_000n);
    const r2 = classify(sale(), [pay({ amountRaw: '9000000' }), pay({ amountRaw: '3000000' })], AL, NOW);
    expect(r2.state).toBe('PAID');
  });
  it('EXTRA: overpay', () => {
    const r = classify(sale(), [pay({ amountRaw: '14000000' })], AL, NOW);
    expect(r.state).toBe('EXTRA');
    expect(r.extraRaw).toBe(2_000_000n);
  });
  it('DUPLICATE: second full payment on a paid ref', () => {
    const r = classify(sale(), [pay(), pay()], AL, NOW);
    expect(r.state).toBe('DUPLICATE');
    expect(r.payments.filter((p) => p.verdict === 'COUNTED')).toHaveLength(1);
  });
  it('FAKE: ref matches but jetton master not allowlisted', () => {
    const r = classify(sale(), [pay({ asset: { kind: 'jetton', master: FAKE_M } })], AL, NOW);
    expect(r.state).toBe('FAKE');
    expect(r.paidRaw).toBe(0n);
  });
  it('UNMATCHED: allowlisted payment with no ref', () => {
    expect(classify(sale(), [pay({ comment: null })], AL, NOW).state).toBe('UNMATCHED');
  });
  it('UNMATCHED: allowlisted payment with unknown ref', () => {
    expect(classify(sale(), [pay({ comment: 'st:zzzz' })], AL, NOW).state).toBe('UNMATCHED');
  });
  it('LATE: matched payment after expiry', () => {
    const r = classify(sale(), [pay({ utime: T0 + 901 })], AL, T0 + 1000);
    expect(r.state).toBe('LATE');
    expect(r.paidRaw).toBe(0n);
  });
  it('LATE: matched payment after void', () => {
    const r = classify(sale({ voidedAt: T0 + 20 }), [pay({ utime: T0 + 30 })], AL, NOW);
    expect(r.state).toBe('LATE');
  });
  it('VOID: voided with nothing received', () => {
    expect(classify(sale({ voidedAt: T0 + 20 }), [], AL, NOW).state).toBe('VOID');
  });
  it('ignore failed / aborted tx', () => {
    const r = classify(sale(), [pay({ success: false })], AL, NOW);
    expect(r.state).toBe('WAITING');
    expect(r.payments[0]!.verdict).toBe('IGNORED');
  });
});

describe('real-world noise', () => {
  it('spam jetton with no ref is ignored, not UNMATCHED', () => {
    const r = classify(sale(), [pay({ asset: { kind: 'jetton', master: FAKE_M }, comment: null })], AL, NOW);
    expect(r.state).toBe('WAITING');
    expect(r.payments[0]!.verdict).toBe('IGNORED');
  });
  it('scam comment text containing a ref does not match', () => {
    const r = classify(
      sale(), [pay({ comment: 'Congrats! claim prize at scam.xyz st:k7q2 now' })], AL, NOW);
    expect(r.state).toBe('UNMATCHED');
    expect(r.paidRaw).toBe(0n);
  });
  it('bounced tx is ignored', () => {
    const r = classify(sale(), [pay({ success: false, amountRaw: '12000000' })], AL, NOW);
    expect(r.paidRaw).toBe(0n);
  });
  it('two sub-refs on one sale: first full payment wins, other is DUPLICATE', () => {
    const r = classify(sale(), [pay({ comment: 'st:k7q2.2', lt: '2000' }), pay({ comment: 'st:k7q2.1', lt: '2001' })], AL, NOW);
    expect(r.state).toBe('DUPLICATE');
    expect(r.payments[0]!.verdict).toBe('COUNTED');
    expect(r.payments[1]!.verdict).toBe('DUPLICATE');
  });
  it('case and whitespace in comment tolerated', () => {
    expect(parseRef('  ST:K7Q2 ')?.ref).toBe('k7q2');
    expect(classify(sale(), [pay({ comment: '  St:K7q2\n' })], AL, NOW).state).toBe('PAID');
  });
  it('address form differences do not break allowlist', () => {
    const lower = { kind: 'jetton' as const, master: GOOD.toLowerCase() };
    expect(classify(sale(), [pay({ asset: lower })], AL, NOW).state).toBe('PAID');
  });
  it('native GRAM sale: native payment PAID, jetton with ref is UNMATCHED (wrong asset)', () => {
    const s = sale({ asset: { kind: 'native' }, amountRaw: 1_000_000_000n });
    const native = pay({ asset: { kind: 'native' }, amountRaw: '1000000000', decimals: 9 });
    expect(classify(s, [native], AL, NOW).state).toBe('PAID');
    expect(classify(s, [pay()], AL, NOW).state).toBe('UNMATCHED');
  });
  it('payment older than the sale is ignored', () => {
    const r = classify(sale(), [pay({ utime: T0 - 5 })], AL, NOW);
    expect(r.state).toBe('WAITING');
  });
});

describe('pending (seen, not finalized) rows', () => {
  it('a matching pending payment is never PAID: state stays WAITING, pendingRaw reports it', () => {
    const r = classify(sale(), [pay({ pending: true })], AL, NOW);
    expect(r.state).toBe('WAITING');
    expect(r.paidRaw).toBe(0n);
    expect(r.pendingRaw).toBe(12_000_000n);
    expect(r.payments[0]!.verdict).toBe('PENDING');
  });
  it('pending does not produce FAKE, UNMATCHED or LATE', () => {
    const fake = classify(sale(), [pay({ pending: true, asset: { kind: 'jetton', master: FAKE_M } })], AL, NOW);
    expect(fake.state).toBe('WAITING');
    expect(fake.pendingRaw).toBe(0n);
    expect(classify(sale(), [pay({ pending: true, comment: null })], AL, NOW).state).toBe('WAITING');
    expect(classify(sale(), [pay({ pending: true, utime: T0 + 2000 })], AL, T0 + 100).pendingRaw).toBe(0n);
  });
  it('pending never tops up a SHORT sale into PAID', () => {
    const r = classify(sale(), [pay({ amountRaw: '9000000' }), pay({ amountRaw: '3000000', pending: true })], AL, NOW);
    expect(r.state).toBe('SHORT');
    expect(r.pendingRaw).toBe(3_000_000n);
  });
  it('the same payment once finalized is PAID', () => {
    expect(classify(sale(), [pay()], AL, NOW).state).toBe('PAID');
  });
});
