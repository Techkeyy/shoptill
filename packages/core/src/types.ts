export type Asset = { kind: 'native' } | { kind: 'jetton'; master: string };

export interface IncomingPayment {
  txHash: string;
  lt: string;
  utime: number;
  success: boolean;
  from: string;
  asset: Asset;
  /** raw units as decimal string */
  amountRaw: string;
  decimals: number;
  comment: string | null;
  /** seen on chain but not yet finalized (only returned with includePending). Never counts as paid. */
  pending?: boolean;
}

export interface Sale {
  /** base reference; sub-refs look like "<ref>.<n>" */
  ref: string;
  amountRaw: bigint;
  /** asset the seller asked to be paid in */
  asset: Asset;
  createdAt: number;
  expiresAt: number;
  voidedAt: number | null;
}

export interface Allowlist {
  /** native GRAM accepted */
  native: boolean;
  /** jetton master addresses (any form) */
  jettonMasters: string[];
}

export type SaleState =
  | 'WAITING' | 'PAID' | 'SHORT' | 'EXTRA' | 'DUPLICATE'
  | 'FAKE' | 'UNMATCHED' | 'LATE' | 'VOID';

export type PaymentVerdict =
  | 'IGNORED' // failed, bounced, spam, older than the sale
  | 'PENDING' // matching payment seen but not finalized: never PAID
  | 'COUNTED' | 'DUPLICATE' | 'FAKE' | 'UNMATCHED' | 'LATE';

export interface ClassifiedPayment {
  payment: IncomingPayment;
  verdict: PaymentVerdict;
  reason: string;
}

export interface SaleResult {
  state: SaleState;
  paidRaw: bigint;
  /** sum of matching, in-window payments that are seen but not finalized */
  pendingRaw: bigint;
  /** paid - amount when state is EXTRA, else 0n */
  extraRaw: bigint;
  /** amount - paid when SHORT, else 0n */
  missingRaw: bigint;
  payments: ClassifiedPayment[];
}
