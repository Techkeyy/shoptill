import './polyfill';

import { Address, beginCell, toNano } from '@ton/core';
import { CHAIN, TonConnectUI, UserRejectsError, type Wallet } from '@tonconnect/ui';

declare global {
  interface Window { Telegram?: { WebApp: any } }
}

interface Info {
  shop: string; state: string; asset: 'USDT' | 'GRAM'; amount: string; amountRaw: string; decimals: number;
  received: string; missing?: string; dueRaw?: string; due?: string; sellerAddress: string; sellerRaw: string; jettonMaster?: string;
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
  let finished = false;
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
      // The receiving wallet must be on the same network as the server (a testnet account here once
      // received a mainnet payment at its mainnet twin address during the pilot).
      let net = 'testnet';
      try { net = (await api('/api/network')).network; } catch { /* default testnet */ }
      if (cur.account.chain !== (net === 'testnet' ? CHAIN.TESTNET : CHAIN.MAINNET)) {
        // A saved TON Connect session keeps the network it was made on, even after the wallet app
        // switches network. Drop it so the seller reconnects fresh on the right network.
        try { await tc.disconnect(); } catch { /* ignore */ }
        draw(`This connection is on the wrong network. Switch your wallet to ${net}, then tap Connect wallet.`);
        return;
      }
      try {
        await api('/api/shop/address', { method: 'POST', body: JSON.stringify({ t: token, address: cur.account.address }) });
        // never let the seller's session leak into the customer pay flow on this device
        finished = true;
        try { await tc.disconnect(); } catch { /* ignore */ }
        render(`<div class="result ok">Done</div><div class="note">Return to the chat. Your counter QR is on its way.</div>
          <button class="main" id="close">Back to chat</button>`);
        document.getElementById('close')!.onclick = () => tg?.close?.();
      } catch (e) { draw((e as Error).message); }
    };
  };
  tc.onStatusChange(() => { if (!finished) draw(); });
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

const POLL_MS = 90_000;

/** Resolves true when finished (result shown), false on timeout. */
async function pollUntilDone(first: Info): Promise<boolean> {
  let info = first;
  const end = Date.now() + POLL_MS;
  render(`<div class="shop">${esc(info.shop)}</div><div class="spin"></div><div class="note">Waiting for the network…</div>`);
  while (Date.now() < end) {
    await wait(2000);
    try { info = await api(`/api/pay/info?ref=${ref}&t=${encodeURIComponent(token)}`); } catch { continue; }
    if (DONE.has(info.state)) { render(resultView(info)); return true; }
  }
  return false;
}

const GRAM_FEE_USDT = 120_000_000n; // 0.12 GRAM
const GRAM_FEE_NATIVE = 20_000_000n; // 0.02 GRAM
const fmt = (raw: bigint, dec: number) => {
  const s = raw.toString().padStart(dec + 1, '0');
  const w = s.slice(0, -dec), f = s.slice(-dec).replace(/0+$/, '');
  return f ? `${w}.${f}` : w;
};

/** Throws a user-facing Error if the customer's wallet cannot cover the payment. */
async function preflight(info: Info, w: Wallet) {
  const q = `ref=${ref}&t=${encodeURIComponent(token)}&owner=${encodeURIComponent(w.account.address)}`;
  const gram = BigInt((await api(`/api/pay/balance?${q}`)).balance ?? '0');
  if (info.asset === 'USDT') {
    const jw = await api(`/api/pay/jetton-wallet?${q}`);
    const bal = BigInt(jw.balance ?? '0');
    const need = BigInt(info.dueRaw ?? info.amountRaw);
    if (!jw.exists || bal < need) throw new Error(`Your wallet doesn't have enough USDT (has ${fmt(jw.exists ? bal : 0n, info.decimals)}, needs ${fmt(need, info.decimals)}).`);
    if (gram < GRAM_FEE_USDT) throw new Error('Your wallet needs a little GRAM for the network fee.');
  } else {
    const need = BigInt(info.dueRaw ?? info.amountRaw);
    if (gram < need + GRAM_FEE_NATIVE) throw new Error(`Your wallet doesn't have enough GRAM (has ${fmt(gram, 9)}, needs ${fmt(need + GRAM_FEE_NATIVE, 9)} including the network fee).`);
  }
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
      messages: [{ address: Address.parse(info.sellerRaw).toString({ bounceable: false, testOnly: info.network === 'testnet' }), amount: info.dueRaw ?? info.amountRaw, payload: b64(comment(payload)) }],
    });
    return;
  }
  const lookup = await api(`/api/pay/jetton-wallet?ref=${ref}&t=${encodeURIComponent(token)}&owner=${encodeURIComponent(w.account.address)}`);
  if (!lookup.exists) throw new Error("Your wallet doesn't have any USDT.");
  const customer = Address.parse(w.account.address);
  const body = beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(BigInt(Date.now()), 64)
    .storeCoins(BigInt(info.dueRaw ?? info.amountRaw))
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

  const testOnly = info.network === 'testnet';
  const friendly = (a: string) => {
    try { const f = Address.parse(a).toString({ bounceable: false, testOnly }); return `${f.slice(0, 4)}…${f.slice(-4)}`; }
    catch { return `${a.slice(0, 4)}…${a.slice(-4)}`; }
  };
  const isSeller = (w: Wallet) => {
    try { return Address.parse(w.account.address).equals(Address.parse(info.sellerRaw)); } catch { return false; }
  };
  const changeWallet = async () => { try { await tc.disconnect(); } catch { /* ignore */ } tc.openModal(); };

  const draw = (err = '') => {
    const w = connected();
    let blockErr = '';
    if (w && w.account.chain !== (info.network === 'testnet' ? CHAIN.TESTNET : CHAIN.MAINNET)) {
      blockErr = info.network === 'testnet' ? 'Switch your wallet to testnet, then reconnect.' : 'Switch your wallet to mainnet, then reconnect.';
    } else if (w && isSeller(w)) {
      blockErr = "This is the shop's own wallet. Switch to the wallet you want to pay from.";
    }
    render(`
      <div class="shop">Pay ${esc(info.shop)}</div>
      <div class="amount">${esc(info.amount)} <span class="asset">${esc(info.asset)}</span></div>
      <div class="note">${testOnly ? 'Test network. No real money.' : ''}</div>
      ${w ? `<div class="note">Wallet: <b>${esc(friendly(w.account.address))}</b> <button id="chg" style="background:none;border:0;padding:0;font:inherit;text-decoration:underline;color:var(--tg-theme-link-color,#0088cc)">Change wallet</button></div>` : ''}
      ${err || blockErr ? `<div class="err">${esc(blockErr || err)}</div>` : ''}
      <button class="main" id="go" ${blockErr ? 'disabled' : ''}>${w ? `Pay ${esc(info.amount)} ${esc(info.asset)}` : 'Connect wallet'}</button>`);
    const chg = document.getElementById('chg');
    if (chg) chg.onclick = () => { void changeWallet(); };
    document.getElementById('go')!.onclick = async () => {
      const cur = connected();
      if (!cur) { tc.openModal(); return; }
      if (isSeller(cur) || (testOnly && cur.account.chain !== CHAIN.TESTNET)) { draw(); return; }
      (document.getElementById('go') as HTMLButtonElement).disabled = true;
      try { await preflight(info, cur); }
      catch (e) { draw((e as Error).message); return; }
      try {
        await sendPayment(info, cur);
      } catch (e) {
        const m = (e as Error).message;
        draw(e instanceof UserRejectsError || /reject|cancel|declin|user denied/i.test(m) ? 'Payment cancelled — nothing was sent.' : m);
        return;
      }
      const waitLoop = async () => {
        if (await pollUntilDone(info)) return;
        render(`<div class="shop">${esc(info.shop)}</div>
          <div class="note">No payment arrived yet. If your wallet showed an error, nothing was sent — you can try again.</div>
          <button class="main" id="again">Try again</button>
          <button class="main" id="keep" style="background:transparent;color:var(--tg-theme-link-color,#0088cc)">Keep waiting</button>`);
        document.getElementById('again')!.onclick = () => draw();
        document.getElementById('keep')!.onclick = () => { void waitLoop(); };
      };
      await waitLoop();
    };
  };
  tc.onStatusChange(() => draw());
  draw();
}

if (mode === 'setup') void setup(); else void pay();
