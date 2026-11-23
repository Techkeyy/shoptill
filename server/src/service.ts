import { randomBytes, randomInt } from 'node:crypto';
import { Address } from '@ton/core';
import { classify, parseRef, normalizeAddress } from '@shoptill/core';
import type { Allowlist, IncomingPayment, Sale, SaleResult } from '@shoptill/core';
import { formatMoney, toRaw, type AssetName } from './amount.ts';
import type { Config } from './config.ts';
import { all, one, run, type DB } from './db.ts';
import type { Tg } from './telegram.ts';

export interface Chain {
  getIncomingTransactions(address: string, sinceUtime: number): Promise<IncomingPayment[]>;
  getJettonTransfersTo(ownerAddress: string, sinceUtime: number): Promise<IncomingPayment[]>;
  /** generic GET passthrough (jetton wallet lookup) */
  raw?(path: string, params: Record<string, string>): Promise<any>;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface Deps { db: DB; cfg: Config; ton: Chain; tg: Tg; now?: () => number; log?: (m: string) => void }

const OPEN_STATES = new Set(['WAITING', 'SHORT', 'UNMATCHED', 'FAKE']);
const NOTIFY_STATES = new Set(['PAID', 'SHORT', 'EXTRA', 'DUPLICATE', 'FAKE', 'UNMATCHED', 'LATE']);
const SALE_TTL = 15 * 60;
const LIVE_WINDOW = 30 * 60;
const GLASSES_ACTIVE_MS = 10_000;

const alnum = 'abcdefghijklmnopqrstuvwxyz0123456789';
const randId = (n: number) => Array.from(randomBytes(n), (b) => alnum[b % alnum.length]).join('');

export const shortAddr = (a: string, testOnly = true) => {
  try {
    const f = Address.parse(a).toString({ testOnly, bounceable: false });
    return `${f.slice(0, 4)}…${f.slice(-3)}`;
  } catch { return a.slice(0, 4) + '…' + a.slice(-3); }
};

export function tonviewerLink(hash: string): string {
  const hex = /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : Buffer.from(hash.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
  return `https://testnet.tonviewer.com/transaction/${hex}`;
}

export class Till {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private ticking = false;
  constructor(private d: Deps) {}

  private nowMs() { return this.d.now ? this.d.now() : Date.now(); }
  private nowSec() { return Math.floor(this.nowMs() / 1000); }
  private log(m: string) { (this.d.log ?? console.log)(m); }

  get allowlist(): Allowlist { return { native: true, jettonMasters: this.d.cfg.jettonMasters }; }

  decimalsOf(asset: string): number { return asset === 'GRAM' ? 9 : this.d.cfg.usdt?.decimals ?? 6; }

  private coreSale(s: any): Sale {
    return {
      ref: s.id, amountRaw: BigInt(s.amount_raw),
      asset: s.asset === 'GRAM' ? { kind: 'native' } : { kind: 'jetton', master: this.d.cfg.usdt!.master },
      createdAt: s.created_at, expiresAt: s.expires_at, voidedAt: s.voided_at,
    };
  }

  // ---------- devices & onboarding ----------

  pair(deviceId: string): { paired: boolean; code?: string; shopName?: string } {
    if (!deviceId) throw new HttpError(400, 'deviceId required');
    let dev = one(this.d.db, 'SELECT * FROM devices WHERE device_id=?', deviceId);
    if (!dev) {
      run(this.d.db, 'INSERT INTO devices(device_id, created_at) VALUES(?,?)', deviceId, this.nowMs());
      dev = one(this.d.db, 'SELECT * FROM devices WHERE device_id=?', deviceId);
    }
    const shop = dev.shop_id ? one(this.d.db, 'SELECT * FROM shops WHERE id=?', dev.shop_id) : undefined;
    if (shop && shop.stage === 'ready') return { paired: true, shopName: shop.name };
    if (!dev.code) {
      for (let i = 0; i < 50; i++) {
        const code = `TILL-${randInt4()}`;
        if (!one(this.d.db, 'SELECT 1 FROM devices WHERE code=?', code)) {
          run(this.d.db, 'UPDATE devices SET code=? WHERE device_id=?', code, deviceId);
          dev.code = code;
          break;
        }
      }
    }
    return { paired: false, code: dev.code };
  }

  /** Seller sent a pairing code to the bot. Returns the new shop id, or null if the code is unknown/used. */
  linkCode(chat: number, code: string): number | null {
    const dev = one(this.d.db, 'SELECT * FROM devices WHERE code=? AND shop_id IS NULL', code.toUpperCase());
    if (!dev) return null;
    const r = run(this.d.db, "INSERT INTO shops(seller_chat, stage, created_at) VALUES(?, 'name', ?)", chat, this.nowMs());
    const shopId = Number(r.lastInsertRowid);
    run(this.d.db, 'UPDATE devices SET shop_id=? WHERE device_id=?', shopId, dev.device_id);
    return shopId;
  }

  sellerShop(chat: number) {
    return one(this.d.db, 'SELECT * FROM shops WHERE seller_chat=? ORDER BY id DESC LIMIT 1', chat);
  }
  shop(id: number) { return one(this.d.db, 'SELECT * FROM shops WHERE id=?', id); }

  setShopName(shopId: number, name: string) {
    run(this.d.db, "UPDATE shops SET name=?, stage='wallet' WHERE id=?", name.trim().slice(0, 60), shopId);
  }

  /** Validates and stores the seller's receiving address (public address only). */
  setShopAddress(shopId: number, address: string) {
    let a: Address;
    try { a = Address.parse(address); } catch { throw new HttpError(400, 'invalid address'); }
    run(this.d.db, "UPDATE shops SET address=?, stage='ready' WHERE id=?", a.toRawString(), shopId);
  }

  friendlyAddress(raw: string): string {
    return Address.parse(raw).toString({ testOnly: this.d.cfg.network === 'testnet', bounceable: false });
  }

  private deviceShop(deviceId: string) {
    const dev = one(this.d.db, 'SELECT * FROM devices WHERE device_id=?', deviceId);
    if (!dev || !dev.shop_id) throw new HttpError(403, 'device not paired');
    const shop = one(this.d.db, 'SELECT * FROM shops WHERE id=?', dev.shop_id);
    if (!shop || shop.stage !== 'ready' || !shop.address) throw new HttpError(409, 'shop setup not finished');
    return { dev, shop };
  }

  // ---------- sales ----------

  arm(deviceId: string, amount: string, asset: string): { saleId: string } {
    const { shop } = this.deviceShop(deviceId);
    if (asset !== 'USDT' && asset !== 'GRAM') throw new HttpError(400, 'bad asset');
    if (asset === 'USDT' && !this.d.cfg.usdt) throw new HttpError(400, 'USDT not configured; GRAM only');
    const decimals = this.decimalsOf(asset);
    const raw = toRaw(amount, decimals);
    if (raw === null || raw <= 0n) throw new HttpError(400, 'bad amount');
    const now = this.nowSec();
    for (const s of all(this.d.db, 'SELECT * FROM sales WHERE shop_id=? AND voided_at IS NULL AND created_at>?', shop.id, now - LIVE_WINDOW)) {
      if (OPEN_STATES.has(s.state)) this.voidSale(s.id);
    }
    const id = randId(8);
    run(this.d.db,
      'INSERT INTO sales(id, shop_id, amount_raw, asset, decimals, created_at, expires_at) VALUES(?,?,?,?,?,?,?)',
      id, shop.id, raw.toString(), asset, decimals, now, now + SALE_TTL);
    run(this.d.db, 'INSERT INTO sale_events(sale_id, state, at) VALUES(?,?,?)', id, 'WAITING', now);
    this.kick();
    return { saleId: id };
  }

  private voidSale(saleId: string) {
    const now = this.nowSec();
    run(this.d.db, 'UPDATE sales SET voided_at=? WHERE id=? AND voided_at IS NULL', now, saleId);
    this.evaluate(saleId);
  }

  void(deviceId: string, saleId: string) {
    const { shop } = this.deviceShop(deviceId);
    const s = one(this.d.db, 'SELECT * FROM sales WHERE id=? AND shop_id=?', saleId, shop.id);
    if (!s) throw new HttpError(404, 'no such sale');
    this.voidSale(saleId);
  }

  sale(id: string) { return one(this.d.db, 'SELECT * FROM sales WHERE id=?', id); }

  armedSaleForShop(shopId: number) {
    const now = this.nowSec();
    const s = one(this.d.db, 'SELECT * FROM sales WHERE shop_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1', shopId);
    if (!s || s.voided_at !== null || now > s.expires_at || !(s.state === 'WAITING' || s.state === 'SHORT')) return undefined;
    return s;
  }

  mintRef(saleId: string, chat: number): string {
    const ref = randId(8);
    run(this.d.db, 'INSERT INTO refs(ref, sale_id, chat_id, created_at) VALUES(?,?,?,?)', ref, saleId, chat, this.nowMs());
    return ref;
  }
  setRefMessage(ref: string, messageId: number) {
    run(this.d.db, 'UPDATE refs SET message_id=? WHERE ref=?', messageId, ref);
  }
  refRow(ref: string) { return one(this.d.db, 'SELECT * FROM refs WHERE ref=?', ref); }

  /** Compute (pure) the classification of a sale from stored payments. */
  private compute(s: any): { res: SaleResult; refOf: Map<string, string | null> } {
    const latest = one(this.d.db, 'SELECT id FROM sales WHERE shop_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1', s.shop_id);
    const rows = all(this.d.db,
      latest?.id === s.id
        ? 'SELECT * FROM payments WHERE shop_id=? AND (sale_id=? OR sale_id IS NULL)'
        : 'SELECT * FROM payments WHERE shop_id=? AND sale_id=?', s.shop_id, s.id);
    const refOf = new Map<string, string | null>();
    const pays: IncomingPayment[] = rows.map((r) => {
      const p = JSON.parse(r.payload) as IncomingPayment;
      refOf.set(p.txHash, r.ref);
      return r.sale_id === s.id ? { ...p, comment: `st:${s.id}` } : p;
    });
    return { res: classify(this.coreSale(s), pays, this.allowlist, this.nowSec()), refOf };
  }

  /** Recompute a sale, persist transitions. Returns true if the state changed. */
  evaluate(saleId: string): boolean {
    const s = one(this.d.db, 'SELECT * FROM sales WHERE id=?', saleId);
    if (!s) return false;
    if (s.asset === 'USDT' && !this.d.cfg.usdt) return false;
    const { res, refOf } = this.compute(s);
    const counted = res.payments.filter((c) => c.verdict === 'COUNTED').map((c) => c.payment);
    const last = counted[counted.length - 1];
    run(this.d.db,
      `UPDATE sales SET state=?, paid_raw=?, extra_raw=?, missing_raw=?, from_addr=?, paid_tx=?, paid_ref=?, paid_at=? WHERE id=?`,
      res.state, res.paidRaw.toString(), res.extraRaw.toString(), res.missingRaw.toString(),
      last?.from ?? null, last?.txHash ?? null, last ? refOf.get(last.txHash) ?? null : null, last?.utime ?? null, saleId);
    if (res.state !== s.state) {
      run(this.d.db, 'INSERT INTO sale_events(sale_id, state, at) VALUES(?,?,?)', saleId, res.state, this.nowSec());
      return true;
    }
    return false;
  }

  private money(s: any, raw: string | bigint) { return `${formatMoney(BigInt(raw), s.decimals)} ${s.asset}`; }

  status(deviceId: string): any {
    const { dev, shop } = this.deviceShop(deviceId);
    run(this.d.db, 'UPDATE devices SET last_poll=? WHERE device_id=?', this.nowMs(), dev.device_id);
    const s = one(this.d.db, 'SELECT * FROM sales WHERE shop_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1', shop.id);
    const now = this.nowSec();
    if (!s || now - s.created_at > LIVE_WINDOW) return { state: 'IDLE' };
    if (s.state === 'VOID') return { state: 'VOID' };
    const out: any = {
      state: s.state,
      sale: {
        saleId: s.id, amount: formatMoney(BigInt(s.amount_raw), s.decimals), asset: s.asset,
        receivedTotal: formatMoney(BigInt(s.paid_raw), s.decimals),
        ageSec: Math.max(0, now - (s.paid_at ?? s.created_at)),
      },
    };
    if (s.paid_at) out.sale.paidAt = s.paid_at;
    if (s.from_addr) out.sale.from = shortAddr(s.from_addr);
    if (s.state === 'EXTRA') out.sale.extra = formatMoney(BigInt(s.extra_raw), s.decimals);
    if (s.state === 'SHORT') out.sale.missing = formatMoney(BigInt(s.missing_raw), s.decimals);
    if (s.state === 'UNMATCHED' && s.asset && !(s.asset === 'USDT' && !this.d.cfg.usdt)) {
      const u = this.compute(s).res.payments.filter((c) => c.verdict === 'UNMATCHED').pop();
      if (u) out.unmatched = {
        amount: formatMoney(BigInt(u.payment.amountRaw), u.payment.decimals),
        from: shortAddr(u.payment.from), paymentId: u.payment.txHash,
      };
    }
    return out;
  }

  attach(deviceId: string, saleId: string, paymentId: string) {
    const { shop } = this.deviceShop(deviceId);
    const s = one(this.d.db, 'SELECT * FROM sales WHERE id=? AND shop_id=?', saleId, shop.id);
    if (!s) throw new HttpError(404, 'no such sale');
    const p = one(this.d.db, 'SELECT * FROM payments WHERE tx_hash=? AND shop_id=? AND sale_id IS NULL', paymentId, shop.id);
    if (!p) throw new HttpError(404, 'no such unmatched payment');
    run(this.d.db, 'UPDATE payments SET sale_id=? WHERE tx_hash=?', saleId, paymentId);
    this.evaluate(saleId);
    this.kick();
  }

  today(deviceId: string) {
    const { shop } = this.deviceShop(deviceId);
    const d = new Date(this.nowMs());
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
    const rows = all(this.d.db, "SELECT * FROM sales WHERE shop_id=? AND state IN ('PAID','EXTRA') AND paid_at>=?", shop.id, start);
    const asset: string = rows.length ? rows[rows.length - 1].asset : this.d.cfg.usdt ? 'USDT' : 'GRAM';
    const mine = rows.filter((r) => r.asset === asset);
    const total = mine.reduce((a, r) => a + BigInt(r.paid_raw), 0n);
    return { count: mine.length, total: formatMoney(total, this.decimalsOf(asset)), asset };
  }

  history(shopId: number, limit = 10) {
    return all(this.d.db, 'SELECT * FROM sales WHERE shop_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?', shopId, limit);
  }

  async receipt(deviceId: string, saleId: string): Promise<{ sent: boolean }> {
    const { shop } = this.deviceShop(deviceId);
    const s = one(this.d.db, 'SELECT * FROM sales WHERE id=? AND shop_id=?', saleId, shop.id);
    if (!s) throw new HttpError(404, 'no such sale');
    if (s.state !== 'PAID' && s.state !== 'EXTRA') throw new HttpError(409, 'receipt only for paid sales');
    if (s.receipt_sent) return { sent: false };
    const ref = s.paid_ref ? this.refRow(s.paid_ref) : undefined;
    const chat = ref?.chat_id ?? one(this.d.db, 'SELECT chat_id FROM refs WHERE sale_id=? AND chat_id IS NOT NULL LIMIT 1', saleId)?.chat_id;
    if (!chat) return { sent: false };
    const when = new Date((s.paid_at ?? this.nowSec()) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const lines = [
      'Receipt', `${this.money(s, s.amount_raw)} paid to ${shop.name}`,
      s.state === 'EXTRA' ? `(you sent ${this.money(s, s.paid_raw)}, ${this.money(s, s.extra_raw)} extra)` : '',
      when, s.paid_tx ? `Tx: ${tonviewerLink(s.paid_tx)}` : '',
    ].filter(Boolean);
    await this.d.tg.send(chat, lines.join('\n'));
    run(this.d.db, 'UPDATE sales SET receipt_sent=1 WHERE id=?', saleId);
    return { sent: true };
  }

  // ---------- Mini App info ----------

  payInfo(ref: string) {
    const r = this.refRow(ref);
    if (!r) return null;
    const s = this.sale(r.sale_id);
    const shop = s && this.shop(s.shop_id);
    if (!s || !shop || !shop.address) return null;
    return {
      shop: shop.name as string, state: s.state as string, asset: s.asset as string,
      amount: formatMoney(BigInt(s.amount_raw), s.decimals), amountRaw: s.amount_raw as string, decimals: s.decimals as number,
      received: formatMoney(BigInt(s.paid_raw), s.decimals),
      missing: s.state === 'SHORT' ? formatMoney(BigInt(s.missing_raw), s.decimals) : undefined,
      sellerAddress: this.friendlyAddress(shop.address), sellerRaw: shop.address as string,
      jettonMaster: s.asset === 'USDT' ? this.d.cfg.usdt?.master : undefined,
      network: this.d.cfg.network, expiresAt: s.expires_at as number,
    };
  }

  /** Jetton wallet lookup for the Mini App; master is forced to the sale's allowlisted one. */
  async jettonWallet(ref: string, owner: string): Promise<{ address: string; balance: string; exists: boolean }> {
    const info = this.payInfo(ref);
    if (!info?.jettonMaster) throw new HttpError(400, 'not a jetton sale');
    try { Address.parse(owner); } catch { throw new HttpError(400, 'bad owner'); }
    if (!this.d.ton.raw) throw new HttpError(501, 'lookup unavailable');
    const j = await this.d.ton.raw('/jetton/wallets', { owner_address: owner, jetton_address: info.jettonMaster, limit: '1' });
    const w = j?.jetton_wallets?.[0];
    if (!w || typeof w.address !== 'string') return { address: '', balance: '0', exists: false };
    return { address: w.address, balance: /^\d+$/.test(String(w.balance ?? '')) ? String(w.balance) : '0', exists: true };
  }

  /** Native (GRAM) balance in nanograms for the Mini App fee pre-check. */
  async accountBalance(ref: string, owner: string): Promise<string> {
    if (!this.payInfo(ref)) throw new HttpError(404, 'unknown ref');
    try { Address.parse(owner); } catch { throw new HttpError(400, 'bad owner'); }
    if (!this.d.ton.raw) throw new HttpError(501, 'lookup unavailable');
    const j = await this.d.ton.raw('/account', { address: owner });
    const b = String(j?.balance ?? '0');
    return /^\d+$/.test(b) ? b : '0';
  }

  // ---------- watcher ----------

  private loop = async () => {
    if (this.stopped) return;
    this.ticking = true;
    let open = false;
    try { open = await this.tick(); } catch (e) { this.log(`tick error: ${(e as Error).message}`); }
    this.ticking = false;
    if (this.stopped) return;
    this.timer = setTimeout(this.loop, open ? 2000 : 30000);
  };
  start() { this.stopped = false; this.timer = setTimeout(this.loop, 0); }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
  /** Run a pass soon (a sale was just armed/attached). */
  kick() {
    if (this.stopped || this.ticking || !this.timer) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(this.loop, 50);
  }

  /** One watcher pass. Returns true when some sale is still open (so the caller polls fast). */
  async tick(): Promise<boolean> {
    const now = this.nowSec();
    const live = all(this.d.db, 'SELECT * FROM sales WHERE created_at>?', now - LIVE_WINDOW);
    const byShop = new Map<number, any[]>();
    for (const s of live) byShop.set(s.shop_id, [...(byShop.get(s.shop_id) ?? []), s]);

    for (const [shopId, sales] of byShop) {
      const shop = this.shop(shopId);
      if (!shop?.address) continue;
      const since = Math.min(...sales.map((s) => s.created_at)) - 60;
      try {
        const [nat, jet] = [
          await this.d.ton.getIncomingTransactions(shop.address, since),
          await this.d.ton.getJettonTransfersTo(shop.address, since),
        ];
        this.ingest(shop, [...nat, ...jet]);
      } catch (e) {
        this.log(`fetch error shop ${shopId}: ${(e as Error).message}`);
      }
    }

    let open = false;
    for (const s of live) {
      this.evaluate(s.id);
      const fresh = this.sale(s.id);
      if (fresh.voided_at === null && now <= fresh.expires_at && OPEN_STATES.has(fresh.state)) open = true;
      if (NOTIFY_STATES.has(fresh.state) && fresh.notified_state !== fresh.state) {
        run(this.d.db, 'UPDATE sales SET notified_state=? WHERE id=?', fresh.state, s.id);
        await this.notify(fresh).catch((e) => this.log(`notify error: ${(e as Error).message}`));
      }
    }
    return open;
  }

  private ingest(shop: any, pays: IncomingPayment[]) {
    for (const p of pays) {
      if (one(this.d.db, 'SELECT 1 FROM payments WHERE tx_hash=?', p.txHash)) continue;
      let saleId: string | null = null;
      let ref: string | null = null;
      const parsed = parseRef(p.comment);
      if (parsed) {
        const r = this.refRow(parsed.ref);
        const direct = this.sale(parsed.ref);
        const sid = r?.sale_id ?? direct?.id;
        const s = sid ? this.sale(sid) : undefined;
        if (s && s.shop_id === shop.id) { saleId = s.id; ref = parsed.ref; }
      }
      run(this.d.db, 'INSERT OR IGNORE INTO payments(tx_hash, shop_id, sale_id, ref, payload, seen_at) VALUES(?,?,?,?,?,?)',
        p.txHash, shop.id, saleId, ref, JSON.stringify(p), this.nowMs());
    }
  }

  private customerText(s: any, shopName: string, payer: boolean): { text: string; keep?: boolean } {
    const amt = this.money(s, s.amount_raw);
    switch (s.state) {
      case 'PAID': return { text: payer ? `Paid ✓ ${amt} to ${shopName}. A receipt will follow.` : `Already paid ✓ ${amt} to ${shopName}.` };
      case 'EXTRA': return { text: `Paid ✓ ${amt} to ${shopName} (${this.money(s, s.extra_raw)} extra received).` };
      case 'SHORT': return { text: `Received ${this.money(s, s.paid_raw)} of ${amt}. ${this.money(s, s.missing_raw)} still missing. Ask the seller.` };
      case 'DUPLICATE': return { text: `Duplicate payment detected for ${amt} to ${shopName}. Contact the seller.` };
      case 'FAKE': return { text: 'Payment NOT accepted: that token is not the one ShopTill accepts. Nothing was paid.' };
      case 'LATE': return { text: `Your payment arrived after the sale closed. Contact ${shopName} to sort it out.` };
      default: return { text: `${s.state}`, keep: true };
    }
  }

  private async notify(s: any) {
    const shop = this.shop(s.shop_id);
    if (!shop) return;
    // customer messages
    if (s.state !== 'UNMATCHED') {
      for (const r of all(this.d.db, 'SELECT * FROM refs WHERE sale_id=? AND chat_id IS NOT NULL AND message_id IS NOT NULL', s.id)) {
        const payer = s.paid_ref ? r.ref === s.paid_ref : true;
        const t = this.customerText(s, shop.name, payer);
        await this.d.tg.edit(r.chat_id, r.message_id, t.text).catch((e) => this.log(`edit error: ${(e as Error).message}`));
      }
    }
    // seller DM only when the glasses app is not actively polling
    const dev = one(this.d.db, 'SELECT * FROM devices WHERE shop_id=?', s.shop_id);
    const glassesActive = dev && this.nowMs() - dev.last_poll < GLASSES_ACTIVE_MS;
    if (glassesActive) return;
    const amt = this.money(s, s.amount_raw);
    const msg: Record<string, string> = {
      PAID: `Paid ${amt} · ${shop.name}`,
      EXTRA: `Paid ${amt} (+${this.money(s, s.extra_raw)} extra) · ${shop.name}`,
      SHORT: `SHORT ${this.money(s, s.paid_raw)} / ${amt} · ${this.money(s, s.missing_raw)} missing · ${shop.name}`,
      DUPLICATE: `DUPLICATE payment for ${amt} · ${shop.name}`,
      FAKE: `FAKE TOKEN, NOT PAID · ${shop.name}`,
      LATE: `LATE payment arrived after the sale closed (${amt}) · ${shop.name}`,
      UNMATCHED: `UNMATCHED payment received while ${amt} was armed · ${shop.name}. Check your glasses.`,
    };
    if (msg[s.state]) await this.d.tg.send(shop.seller_chat, msg[s.state]!);
  }
}

function randInt4() { return String(randInt(1000, 10000)); }
function randInt(a: number, b: number) { return randomInt(a, b); }
export { normalizeAddress };
