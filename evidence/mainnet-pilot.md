# Mainnet pilot: one real payment (2026-11-24)

The same code and server as the testnet build, switched to the real TON network for one sale with
`server/deploy/network.sh mainnet`, using its own database. It was switched back to testnet straight after.
The owner used their own money: 0.1 GRAM, about $0.10.

| Step | Result |
|---|---|
| Pair + onboarding | New glasses code → @ShopTillBot → shop "Barber g" → seller wallet connected through TON Connect (mainnet). The wallet Tonkeeper connected was the owner's test "Customer" key on mainnet (`UQA4…Anaz`), not their main shop wallet. Same owner and same keys, so the funds are theirs. |
| Voice | `stt heard "zero point one gram." -> 0.10 GRAM`. The confirm screen showed it, and the seller tapped to arm. |
| Customer | Tonkeeper mainnet wallet `UQCC…QSEM` scanned the counter QR, opened the Mini App, and paid 0.1 GRAM |
| Glasses | **PAID 0.10 GRAM** (`evidence/screens/mainnet-paid.png`) |
| Detection | Server log: `chain->seen=5.5s chain->paid=5.5s` (no TON Center API key, so ~1 request/s) |
| Receipt | Tap on glasses → receipt with a mainnet tonviewer link |

**Transaction (mainnet, finalized):**
https://tonviewer.com/transaction/4549066d17326fa1c0cd98a5a7abf0a75f6b4db7c4737552c341c87269dc6332

Independent check on TON Center v3: `finality: finalized`, `credit: 100000000` (0.1 GRAM),
comment `st:at99es2t` (the per-customer reference). It was reported `aborted: true` because the seller wallet had never been used,
which is the exact case the "money stayed" rule handles (see `packages/core/src/toncenter.ts`).

Earlier in the same session, Whisper heard "0.1" without the word "gram" and offered 0.10 USDT. The confirm step caught it before anything was charged.
"gram" was then added to the speech prompt.

**Why the payment went to the owner's test wallet.** In setup mode the Mini App only accepted a wallet on testnet, even while the server ran on mainnet. So the owner had to connect a testnet account, and its address is the same on mainnet; the 0.1 GRAM landed at that mainnet twin. Found by the audit on 2026-11-24 and fixed: setup now asks the server which network it runs on (`GET /api/network`) and requires the wallet to match, and the pay page blocks a wallet on the wrong network in both directions.

Found and fixed during the pilot: the glasses showed the sender in testnet address form (`0Q…`). They now use the network's own form (`UQ…`).
