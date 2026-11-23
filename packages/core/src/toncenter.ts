import { Cell } from '@ton/core';
import { normalizeAddress } from './address.ts';
import type { IncomingPayment } from './types.ts';

export interface ClientOpts {
  baseUrl?: string;
  apiKey?: string;
  /** min ms between requests (default 1100 without key, 150 with) */
  minIntervalMs?: number;
  /** decimals per jetton master (any address form) */
  jettonDecimals?: Record<string, number>;
  defaultJettonDecimals?: number;
}

const TESTNET = 'https://testnet.toncenter.com/api/v3';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TonCenter {
  private last = 0;
  private baseUrl: string;
  private apiKey?: string;
  private minInterval: number;
  private decimals = new Map<string, number>();
  private defDec: number;

  constructor(o: ClientOpts = {}) {
    this.baseUrl = o.baseUrl ?? TESTNET;
    this.apiKey = o.apiKey ?? process.env.TONCENTER_API_KEY;
    this.minInterval = o.minIntervalMs ?? (this.apiKey ? 150 : 1100);
    this.defDec = o.defaultJettonDecimals ?? 6;
    for (const [k, v] of Object.entries(o.jettonDecimals ?? {})) this.decimals.set(normalizeAddress(k), v);
  }

  async get(path: string, params: Record<string, string | number>): Promise<any> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = this.last + this.minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      const res = await fetch(url, { headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {} });
      if (res.status === 429 || res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`toncenter ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.json();
    }
    throw new Error('toncenter: retries exhausted');
  }

  /** Native incoming transfers (plain value transfers; jetton notifications/excess are excluded). */
  async getIncomingTransactions(address: string, sinceUtime: number): Promise<IncomingPayment[]> {
    const j = await this.get('/transactions', {
      account: address, start_utime: sinceUtime, sort: 'desc', limit: 100,
    });
    const out: IncomingPayment[] = [];
    for (const t of j.transactions ?? []) {
      const m = t.in_msg;
      if (!m || !m.source) continue; // external or none
      if (t.finality && t.finality !== 'finalized') continue;
      const op = m.opcode;
      if (op != null && Number(op) !== 0) continue; // jetton notification, excess, etc.
      const d = t.description ?? {};
      const success =
        d.aborted === false && d.compute_ph?.success !== false && d.action?.success !== false &&
        m.bounced !== true;
      out.push({
        txHash: t.hash, lt: String(t.lt), utime: t.now, success,
        from: normalizeAddress(m.source),
        asset: { kind: 'native' },
        amountRaw: String(m.value ?? '0'), decimals: 9,
        comment: m.message_content?.decoded?.type === 'text_comment'
          ? String(m.message_content.decoded.comment) : null,
      });
    }
    return out;
  }

  async getJettonTransfersTo(ownerAddress: string, sinceUtime: number): Promise<IncomingPayment[]> {
    const j = await this.get('/jetton/transfers', {
      owner_address: ownerAddress, direction: 'in', start_utime: sinceUtime, sort: 'desc', limit: 100,
    });
    const out: IncomingPayment[] = [];
    for (const t of j.jetton_transfers ?? []) {
      const master = normalizeAddress(t.jetton_master);
      out.push({
        txHash: t.transaction_hash, lt: String(t.transaction_lt), utime: t.transaction_now,
        success: t.transaction_aborted === false,
        from: normalizeAddress(t.source),
        asset: { kind: 'jetton', master },
        amountRaw: String(t.amount), decimals: this.decimals.get(master) ?? this.defDec,
        comment: decodeForwardComment(t),
      });
    }
    return out;
  }
}

function readComment(s: ReturnType<Cell['beginParse']>): string | null {
  if (s.remainingBits >= 32 && s.loadUint(32) === 0) return s.loadStringTail();
  return null;
}

/** forward_payload may be pre-decoded by toncenter, or a base64 BOC (inline, or Either-ref). */
export function decodeForwardComment(t: any): string | null {
  const dec = t.decoded_forward_payload;
  if (dec && typeof dec === 'object' && dec.type === 'text_comment' && typeof dec.comment === 'string') {
    return dec.comment;
  }
  if (typeof t.forward_payload !== 'string') return null;
  try {
    const cell = Cell.fromBase64(t.forward_payload);
    // variant A: body cell itself is the comment (op 0)
    const a = readComment(cell.beginParse());
    if (a !== null) return a;
    // variant B: Either bit prefix; 1 = payload in first ref
    const s = cell.beginParse();
    const bit = s.loadBit();
    return readComment(bit ? s.loadRef().beginParse() : s);
  } catch {
    return null;
  }
}
