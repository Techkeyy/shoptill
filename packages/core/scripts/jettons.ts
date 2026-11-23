import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromNano, toNano } from '@ton/core';
import { AssetsSDK } from '@ton-community/assets-sdk';
import { client, friendly, loadWallet, readSecretJson, retry, ROOT, SECRETS, sleep } from './common.ts';

const out = resolve(SECRETS, 'testnet-jettons.json');
if (existsSync(out)) { console.log('jettons already deployed:', readSecretJson('testnet-jettons.json')); process.exit(0); }

const c = client();
const cust = await loadWallet('customer');
const bal = await retry(() => c.getBalance(cust.address));
console.log('customer balance', fromNano(bal));
if (bal < toNano('1')) { console.error('need >= 1 GRAM on customer'); process.exit(2); }

const opened = c.open(cust.contract);
const sdk = AssetsSDK.create({ api: c as any, sender: opened.sender(cust.kp.secretKey) });

async function deploy(name: string, description: string) {
  const minter = await retry(() => sdk.deployJetton(
    { name, symbol: 'USDT', decimals: 6, description },
    { onchainContent: true, premintAmount: 1_000_000_000n, adminAddress: cust.address, value: toNano('0.25') },
  ));
  console.log(`${name} master`, friendly(minter.address, true));
  return minter;
}
const real = await deploy('USDT (ShopTill test)', 'ShopTill allowlisted test USDT');
await sleep(20_000);
const fake = await deploy('USDT (ShopTill test)', 'ShopTill look-alike (FAKE)');
await sleep(20_000);

for (const [n, m] of [['real', real], ['fake', fake]] as const) {
  const w = await retry(() => m.getWallet(cust.address));
  const d = await retry(() => w.getData()).catch(() => null);
  console.log(n, 'customer jetton balance', d ? d.balance : 'pending (not deployed yet)');
}

writeFileSync(out, JSON.stringify({
  allowlisted: { master: real.address.toRawString(), friendly: friendly(real.address, true) },
  fake: { master: fake.address.toRawString(), friendly: friendly(fake.address, true) },
}, null, 2));
writeFileSync(resolve(ROOT, 'packages/core/testnet.config.json'), JSON.stringify({
  network: 'testnet',
  allowlistedJettonMaster: real.address.toRawString(),
  allowlistedJettonMasterFriendly: friendly(real.address, true),
  decimals: 6, symbol: 'USDT',
}, null, 2) + '\n');
console.log('saved');
