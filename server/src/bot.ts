import QRCode from 'qrcode';
import { signToken } from './auth.ts';
import type { Config } from './config.ts';
import { formatMoney } from './amount.ts';
import type { Till } from './service.ts';
import type { Tg, Update, Markup } from './telegram.ts';

const TOKEN_TTL = 20 * 60;
/** Setup links only bind a public address to the chat that asked; a day is fine. */
const SETUP_TTL = 24 * 60 * 60;
const HELP = [
  'ShopTill commands',
  '/today - sales and total for today (UTC)',
  '/history - your last 10 sales',
  '/wallet - connect or change the wallet that receives payments',
  '/help - this message',
  '',
  'To set up: send me the code shown on your glasses (like TILL-123456).',
].join('\n');

export class Bot {
  username = '';
  constructor(private svc: Till, private tg: Tg, private cfg: Config, private log: (m: string) => void = console.log) {}

  async init() { this.username = (await this.tg.me()).username; }

  private nowSec() { return Math.floor(Date.now() / 1000); }

  private payUrl(saleId: string, ref: string, chat: number) {
    const t = signToken({ k: 'pay', chat, ref, exp: this.nowSec() + TOKEN_TTL }, this.cfg.botToken);
    return `${this.cfg.publicUrl}/pay/?sale=${saleId}&ref=${ref}&t=${encodeURIComponent(t)}`;
  }

  counterLink(shopId: number) { return `https://t.me/${this.username}?start=shop_${shopId}`; }

  async handle(u: Update): Promise<void> {
    if (u.callback_query) return this.onCallback(u.callback_query);
    const m = u.message;
    if (!m || m.chat.type !== 'private' || typeof m.text !== 'string') return;
    const chat = m.chat.id;
    const text = m.text.trim();

    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
    if (start) {
      const payload = start[1];
      const shopM = payload ? /^shop_(\d+)$/.exec(payload) : null;
      if (shopM) return this.customerStart(chat, Number(shopM[1]));
      await this.tg.send(chat, 'Welcome to ShopTill. Send me the code shown on your glasses (like TILL-123456).');
      return;
    }
    if (/^\/help(?:@\w+)?$/.test(text)) { await this.tg.send(chat, HELP); return; }
    if (/^\/today(?:@\w+)?$/.test(text)) return this.cmdToday(chat);
    if (/^\/history(?:@\w+)?$/.test(text)) return this.cmdHistory(chat);
    if (/^\/wallet(?:@\w+)?$/.test(text)) {
      const s = this.svc.sellerShop(chat);
      if (!s || s.stage === 'name') { await this.tg.send(chat, 'First send me the code shown on your glasses (like TILL-123456).'); return; }
      await this.sendWalletPrompt(chat, s.id, s.name);
      return;
    }

    const code = /^TILL-\d{4,6}$/i.exec(text);
    if (code) {
      const linked = this.svc.tryLink(chat, code[0]);
      if (linked === 'locked') { await this.tg.send(chat, 'Too many wrong codes. Wait a few minutes and try again.'); return; }
      if (linked === 'bad') { await this.tg.send(chat, 'I do not know that code. Check the glasses and try again.'); return; }
      const linkedShop = this.svc.shop(linked.shopId);
      if (linkedShop?.stage === 'ready') {
        await this.tg.send(chat, `Linked these glasses to "${linkedShop.name}". Same wallet, and your counter QR still works. Say a price to start.`);
        return;
      }
      await this.tg.send(chat, 'Linked. What is your shop called? (This is what customers see.)');
      return;
    }

    const shop = this.svc.sellerShop(chat);
    if (shop?.stage === 'name' && !text.startsWith('/')) {
      this.svc.setShopName(shop.id, text);
      await this.sendWalletPrompt(chat, shop.id, text);
      return;
    }
    if (shop?.stage === 'wallet') { await this.sendWalletPrompt(chat, shop.id, shop.name); return; }
    await this.tg.send(chat, HELP);
  }

  private async sendWalletPrompt(chat: number, shopId: number, name: string) {
    const t = signToken({ k: 'setup', chat, shop: shopId, exp: this.nowSec() + SETUP_TTL }, this.cfg.botToken);
    const url = `${this.cfg.publicUrl}/pay/?mode=setup&t=${encodeURIComponent(t)}`;
    await this.tg.send(chat, `Great, "${name}". Now connect the wallet that should receive payments. Only your public address is read.`,
      { inline_keyboard: [[{ text: 'Connect your wallet', web_app: { url } }]] });
  }

  /** Called after the Mini App stored the seller address: send the counter QR. */
  async finishSetup(shopId: number) {
    const shop = this.svc.shop(shopId);
    if (!shop) return;
    const png = await QRCode.toBuffer(this.counterLink(shopId), { width: 640, margin: 2, errorCorrectionLevel: 'M' });
    await this.tg.photo(shop.seller_chat, new Uint8Array(png), 'Print this and stick it on your counter');
    await this.tg.send(shop.seller_chat, `All set. Say a price on your glasses and customers scanning this code will be asked to pay. Commands: /today /history /help`);
  }

  private async customerStart(chat: number, shopId: number) {
    const shop = this.svc.shop(shopId);
    if (!shop || shop.stage !== 'ready') { await this.tg.send(chat, 'This shop is not set up yet.'); return; }
    const sale = this.svc.armedSaleForShop(shopId);
    if (!sale) {
      await this.tg.send(chat, "The seller hasn't set a price yet. Ask them, then tap Refresh.",
        { inline_keyboard: [[{ text: 'Refresh', callback_data: `refresh:${shopId}` }]] });
      return;
    }
    const { text, markup, ref } = this.payMessage(chat, sale, shop.name);
    const mid = await this.tg.send(chat, text, markup);
    this.svc.setRefMessage(ref, mid);
  }

  private payMessage(chat: number, sale: any, shopName: string): { text: string; markup: Markup; ref: string } {
    const ref = this.svc.mintRef(sale.id, chat);
    const amt = `${formatMoney(BigInt(sale.amount_raw), sale.decimals)} ${sale.asset}`;
    return {
      ref,
      text: `Pay ${amt} to ${shopName}`,
      markup: { inline_keyboard: [[{ text: 'Pay', web_app: { url: this.payUrl(sale.id, ref, chat) } }]] },
    };
  }

  private async onCallback(cb: NonNullable<Update['callback_query']>) {
    const m = /^refresh:(\d+)$/.exec(cb.data ?? '');
    if (!m || !cb.message) { await this.tg.answerCb(cb.id); return; }
    const shopId = Number(m[1]);
    const chat = cb.message.chat.id;
    const shop = this.svc.shop(shopId);
    const sale = shop ? this.svc.armedSaleForShop(shopId) : undefined;
    if (!shop || !sale) { await this.tg.answerCb(cb.id, 'Still no price. Ask the seller.'); return; }
    const { text, markup, ref } = this.payMessage(chat, sale, shop.name);
    await this.tg.edit(chat, cb.message.message_id, text, markup);
    this.svc.setRefMessage(ref, cb.message.message_id);
    await this.tg.answerCb(cb.id);
  }

  private async cmdToday(chat: number) {
    const shop = this.svc.sellerShop(chat);
    if (!shop || shop.stage !== 'ready') { await this.tg.send(chat, 'Set up your shop first: send me the code shown on your glasses.'); return; }
    const d = new Date();
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
    const rows = this.svc.history(shop.id, 1000).filter((s) => (s.state === 'PAID' || s.state === 'EXTRA') && s.paid_at >= start);
    const byAsset = new Map<string, bigint>();
    for (const s of rows) byAsset.set(s.asset, (byAsset.get(s.asset) ?? 0n) + BigInt(s.paid_raw));
    const parts = [...byAsset].map(([a, v]) => `${formatMoney(v, this.svc.decimalsOf(a))} ${a}`);
    await this.tg.send(chat, rows.length ? `Today: ${rows.length} sale(s), ${parts.join(' + ')}` : 'No paid sales yet today.');
  }

  private async cmdHistory(chat: number) {
    const shop = this.svc.sellerShop(chat);
    if (!shop || shop.stage !== 'ready') { await this.tg.send(chat, 'Set up your shop first: send me the code shown on your glasses.'); return; }
    const rows = this.svc.history(shop.id, 10);
    if (!rows.length) { await this.tg.send(chat, 'No sales yet.'); return; }
    await this.tg.send(chat, rows.map((s) =>
      `${new Date(s.created_at * 1000).toISOString().slice(5, 16).replace('T', ' ')} · ${formatMoney(BigInt(s.amount_raw), s.decimals)} ${s.asset} · ${s.state}`).join('\n'));
  }

  async poll(signal: { stopped: boolean }) {
    let offset = 0;
    while (!signal.stopped) {
      try {
        const ups = await this.tg.getUpdates(offset, 25);
        for (const u of ups) {
          offset = u.update_id + 1;
          try { await this.handle(u); } catch (e) { this.log(`bot handler error: ${(e as Error).message}`); }
        }
      } catch (e) {
        this.log(`getUpdates error: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}
