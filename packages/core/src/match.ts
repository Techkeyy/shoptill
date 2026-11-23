import { normalizeAddress } from './address.ts';
import type {
  Allowlist, Asset, ClassifiedPayment, IncomingPayment, Sale, SaleResult, SaleState,
} from './types.ts';

const REF_RE = /^st:([a-z0-9]+)(?:\.([0-9]+))?$/;

/** Extract the ref only if the WHOLE comment is `st:<ref>[.<n>]` (case/whitespace tolerant). */
export function parseRef(comment: string | null): { ref: string; sub: string | null } | null {
  if (!comment) return null;
  const m = REF_RE.exec(comment.trim().replace(/\s+/g, ' ').toLowerCase());
  return m ? { ref: m[1]!, sub: m[2] ?? null } : null;
}

function sameAsset(a: Asset, b: Asset): boolean {
  if (a.kind === 'native' || b.kind === 'native') return a.kind === b.kind;
  return normalizeAddress(a.master) === normalizeAddress(b.master);
}

function allowlisted(asset: Asset, al: Allowlist): boolean {
  if (asset.kind === 'native') return al.native;
  const m = normalizeAddress(asset.master);
  return al.jettonMasters.some((x) => normalizeAddress(x) === m);
}

const cmpLt = (a: IncomingPayment, b: IncomingPayment) => {
  const x = BigInt(a.lt), y = BigInt(b.lt);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Order of checks: success -> allowlisted token -> ref -> amount -> time window.
 * `payments` may contain anything the seller address ever received.
 */
export function classify(
  sale: Sale, payments: IncomingPayment[], allowlist: Allowlist, now: number,
): SaleResult {
  const out: ClassifiedPayment[] = [];
  let paid = 0n;
  let closed = false;
  let extra = 0n;
  const ref = sale.ref.toLowerCase();

  for (const p of [...payments].sort(cmpLt)) {
    const add = (verdict: ClassifiedPayment['verdict'], reason: string) =>
      out.push({ payment: p, verdict, reason });

    // 1. success (client only returns finalized txs)
    if (!p.success) { add('IGNORED', 'failed or bounced'); continue; }
    if (p.utime < sale.createdAt) { add('IGNORED', 'before sale'); continue; }

    const parsed = parseRef(p.comment);
    const refMatches = parsed !== null && parsed.ref === ref;

    // 2. token allowlist
    if (!allowlisted(p.asset, allowlist)) {
      if (refMatches) add('FAKE', 'ref matches but token not allowlisted');
      else add('IGNORED', 'non-allowlisted token, no ref (spam)');
      continue;
    }

    // 3. reference
    if (!refMatches) { add('UNMATCHED', parsed ? 'unknown ref' : 'no ref'); continue; }
    if (!sameAsset(p.asset, sale.asset)) { add('UNMATCHED', 'wrong allowlisted asset for this sale'); continue; }

    // 5. time window (checked before accounting so late money never counts)
    if (p.utime > sale.expiresAt || (sale.voidedAt !== null && p.utime >= sale.voidedAt)) {
      add('LATE', 'after void or expiry'); continue;
    }

    // 4. amount
    if (closed) { add('DUPLICATE', 'sale already paid'); continue; }
    paid += BigInt(p.amountRaw);
    add('COUNTED', 'matched');
    if (paid >= sale.amountRaw) { closed = true; extra = paid - sale.amountRaw; }
  }

  const has = (v: ClassifiedPayment['verdict']) => out.some((c) => c.verdict === v);
  const inactive = sale.voidedAt !== null || now > sale.expiresAt;
  let state: SaleState;
  if (closed) state = has('DUPLICATE') ? 'DUPLICATE' : extra > 0n ? 'EXTRA' : 'PAID';
  else if (has('LATE')) state = 'LATE';
  else if (inactive) state = 'VOID';
  else if (has('FAKE')) state = 'FAKE';
  else if (paid > 0n) state = 'SHORT';
  else if (has('UNMATCHED')) state = 'UNMATCHED';
  else state = 'WAITING';

  return {
    state, paidRaw: paid,
    extraRaw: state === 'EXTRA' ? extra : 0n,
    missingRaw: state === 'SHORT' ? sale.amountRaw - paid : 0n,
    payments: out,
  };
}
