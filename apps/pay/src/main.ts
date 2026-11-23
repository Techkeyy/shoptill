import { Buffer } from 'buffer';
(globalThis as any).Buffer = Buffer;

import { Address, beginCell, toNano } from '@ton/core';
import { CHAIN, TonConnectUI, type Wallet } from '@tonconnect/ui';

declare global {
  interface Window { Telegram?: { WebApp: any } }
}

interface Info {
  shop: string; state: string; asset: 'USDT' | 'GRAM'; amount: string; amountRaw: string; decimals: number;
  received: string; missing?: string; sellerAddress: string; sellerRaw: string; jettonMaster?: string;
  network: 'testnet' | 'mainnet'; expiresAt: number;
}

const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();
const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const ref = params.get('ref') ?? '';
const token = params.get('t') ?? '';
const app = document.getElementById('app')!;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const render = (html: string) => { app.innerHTML = html; };

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-tg-init-data': tg?.initData ?? '', ...(init.headers ?? {}) },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `error ${res.status}`);
  return j;
}

const tc = new TonConnectUI({ manifestUrl: `${location.origin}/tonconnect-manifest.json` });
const connected = (): Wallet | null => tc.wallet;

function comment(text: string) {
  return beginCell().storeUint(0, 32).storeStringTail(text).endCell();
}
const b64 = (c: ReturnType<typeof comment>) => c.toBoc().toString('base64');

async function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ---------- setup mode ----------

async function setup() {
  const draw = (err = '') => {
    const w = connected();
    render(`
      <div class="shop">ShopTill</div>
      <div class="amount" style="font-size:32px">Connect your wallet</div>
      <div class="note">We only read your public address, so customers can pay you directly. We never hold your funds.</div>
      ${err ? `<div class="err">${esc(err)}</div>` : ''}
      <button class="main" id="go">${w ? 'Use this wallet' : 'Connect wallet'}</button>`);
    document.getElementById('go')!.onclick = async () => {
      const cur = connected();
      if (!cur) { tc.openModal(); return; }
      if (cur.account.chain !== CHAIN.TESTNET) { draw('Please switch your wallet to testnet, then reconnect.'); return; }
      try {
        await api('/api/shop/address', { method: 'POST', body: JSON.stringify({ t: token, address: cur.account.address }) });
        render(`<div class="result ok">Done</div><div class="note">Return to the chat. Your counter QR is on its way.</div>
          <button class="main" id="close">Back to chat</button>`);
        document.getElementById('close')!.onclick = () => tg?.close?.();
      } catch (e) { draw((e as Error).message); }
    };
  };
  tc.onStatusChange(() => draw());
  draw();
}

// ---------- pay mode ----------

const DONE = new Set(['PAID', 'EXTRA', 'DUPLICATE', 'FAKE', 'LATE', 'VOID']);

function resultView(info: Info) {
  const amt = `${info.amount} ${info.asset}`;
  switch (info.state) {
    case 'PAID': return `<div class="result ok">Paid ✓</div><div class="amount">${esc(amt)}</div><div class="note">to ${esc(info.shop)}. You will get a receipt in the chat.</div>`;
    case 'EXTRA': return `<div class="result ok">Paid ✓</div><div class="note">${esc(amt)} to ${esc(info.shop)} (a little extra was received).</div>`;
    case 'SHORT': return `<div class="result warn">Short</div><div class="note">Received ${esc(info.received)} of ${esc(amt)}. ${esc(info.missing ?? '')} missing. Ask the seller.</div>`;
    case 'DUPLICATE': return `<div class="result warn">Duplicate</div><div class="note">A second payment arrived. Contact the seller.</div>`;
    case 'FAKE': return `<div class="result bad">Not accepted</div><div class="note">That token is not the one this shop accepts. Nothing was paid.</div>`;
    case 'LATE': return `<div class="result warn">Too late</div><div class="note">The payment arrived after the sale closed. Contact the seller.</div>`;
    case 'VOID': return `<div class="result bad">Sale closed</div><div class="note">Ask the seller for a new price.</div>`;
    default: return '';
  }
}

async function pollUntilDone(first: Info) {
  let info = first;
  for (let i = 0; i < 150; i++) {
    render(`<div class="shop">${esc(info.shop)}</div><div class="spin"></div><div class="note">Waiting for the network…</div>`);
    await wait(2000);
    try { info = await api(`/api/pay/info?ref=${ref}&t=${encodeURIComponent(token)}`); } catch { continue; }
    if (DONE.has(info.state) || info.state === 'SHORT') { render(resultView(info)); if (info.state !== 'SHORT') return; }
  }
  render(`<div class="note">Still waiting. You can close this; the seller will see the payment when it lands.</div>`);
}

async function sendPayment(info: Info, w: Wallet) {
  const validUntil = Math.floor(Date.now() / 1000) + 300;
  const network = info.network === 'testnet' ? CHAIN.TESTNET : CHAIN.MAINNET;
  const payload = `st:${ref}`;
  if (info.asset === 'GRAM') {
    await tc.sendTransaction({
      validUntil, network,
      // Non-bounceable: a fresh seller wallet (never used) would bounce a bounceable payment
      // back to the customer (seen on testnet, evidence/p0-spike.md).
      messages: [{ address: Address.parse(info.sellerRaw).toString({ bounceable: false, testOnly: info.network === 'testnet' }), amount: info.amountRaw, payload: b64(comment(payload)) }],
    });
    return;
  }
  const lookup = await api(`/api/pay/jetton-wallet?ref=${ref}&t=${encodeURIComponent(token)}&owner=${encodeURIComponent(w.account.address)}`);
  const customer = Address.parse(w.account.address);
  const body = beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(BigInt(Date.now()), 64)
    .storeCoins(BigInt(info.amountRaw))
    .storeAddress(Address.parse(info.sellerRaw))
    .storeAddress(customer)
    .storeBit(0)
    .storeCoins(toNano('0.01'))
    .storeBit(1)
    .storeRef(comment(payload))
    .endCell();
  await tc.sendTransaction({
    validUntil, network,
    // Bounceable to the customer's own jetton wallet so a failed transfer refunds. 0.05 TON
    // failed with exit 709 (not enough TON) on testnet; 0.1 works (excess is returned).
    messages: [{ address: Address.parse(lookup.address).toString({ bounceable: true, testOnly: info.network === 'testnet' }), amount: toNano('0.1').toString(), payload: b64(body) }],
  });
}

async function pay() {
  let info: Info;
  try { info = await api(`/api/pay/info?ref=${ref}&t=${encodeURIComponent(token)}`); }
  catch (e) { render(`<div class="result bad">Cannot open</div><div class="note">${esc((e as Error).message)}. Go back to the chat and tap Pay again.</div>`); return; }

  if (DONE.has(info.state)) { render(info.state === 'PAID' || info.state === 'EXTRA' ? `<div class="result ok">Already paid</div><div class="note">This sale is paid. Nothing more to do.</div>` : resultView(info)); return; }

  const draw = (err = '') => {
    const w = connected();
    let chainErr = '';
    if (w && info.network === 'testnet' && w.account.chain !== CHAIN.TESTNET) {
      chainErr = 'Switch your wallet to testnet, then reconnect.';
    }
    render(`
      <div class="shop">Pay ${esc(info.shop)}</div>
      <div class="amount">${esc(info.amount)} <span class="asset">${esc(info.asset)}</span></div>
      <div class="note">${info.network === 'testnet' ? 'Test network. No real money.' : ''}</div>
      ${err || chainErr ? `<div class="err">${esc(err || chainErr)}</div>` : ''}
      <button class="main" id="go" ${chainErr ? 'disabled' : ''}>${w ? `Pay ${esc(info.amount)} ${esc(info.asset)}` : 'Connect wallet'}</button>
      ${w ? '<button class="main" id="disc" style="background:transparent;color:var(--tg-theme-link-color,#0088cc)">Use another wallet</button>' : ''}`);
    document.getElementById('go')!.onclick = async () => {
      const cur = connected();
      if (!cur) { tc.openModal(); return; }
      if (info.network === 'testnet' && cur.account.chain !== CHAIN.TESTNET) { draw(); return; }
      (document.getElementById('go') as HTMLButtonElement).disabled = true;
      try {
        await sendPayment(info, cur);
        await pollUntilDone(info);
      } catch (e) {
        const m = (e as Error).message;
        draw(/reject|cancel|declin/i.test(m) ? 'Payment cancelled.' : m);
      }
    };
    const d = document.getElementById('disc');
    if (d) d.onclick = () => { void tc.disconnect(); };
  };
  tc.onStatusChange(() => draw());
  draw();
}

if (mode === 'setup') void setup(); else void pay();
