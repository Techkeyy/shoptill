# ShopTill demo script (target 2:50, hard limit 3:00)

Built around one moment a rival cannot show: **a screenshot does nothing, and only a real on-chain payment flips the glasses to PAID. Then a look-alike USDT with the right reference is refused.**

**Climax line (say it slowly, then stay silent for one full second, hands off the mouse):**
> "The glasses believe the chain. Not the customer."

Everything on screen is the real product against the live server on TON testnet. No mock mode (`VITE_MOCK` must be unset). Captions are burned in so the video reads with sound off.

## Before you record

**Stage these tabs and windows first.** Switching on camera is fine. Waiting for a page to load is not.

| # | System | What | Pre-state |
|---|---|---|---|
| A | Glasses simulator (`npm run simulate`, app at http://localhost:5173 built with `VITE_API_BASE=https://shoptill.103-195-188-198.sslip.io`) | The seller's glasses | Already paired and shop named. Idle screen "Say a price" |
| B | Phone or Telegram Desktop, **customer** account | Chat with @ShopTillBot (https://t.me/ShopTillBot) | Counter QR link ready to tap |
| C | Phone, Tonkeeper **testnet** | The customer wallet | At least 13 test USDT, 0.5 test GRAM; connected wallet is the customer, **not** the shop wallet (otherwise the pay page blocks self-pay) |
| D | Browser, **TON testnet** explorer | https://testnet.tonviewer.com/ | Empty tab, ready to paste a hash |
| E | Browser | https://testnet.tonviewer.com/transaction/060c5dce548948be0a171a0f6002f40ae40987ae4293b1e2b45cc9d56efcaefc | The real owner payment (UAT 1) loaded |
| F | Browser | evidence/live-states.md (local file or the public repo once it is public) | Scrolled to the 8-row table |
| G | Terminal | Attacker helper (see Scene 5 staging) | Not shown until Scene 5 |

**Label which system is which on screen.** Glasses simulator = seller. Telegram on phone = customer. Tonviewer = TON testnet. Add a small corner tag "TESTNET" for the whole video.

**Checks that would ruin a take (run right before Scene 1):**
1. `curl -s https://shoptill.103-195-188-198.sslip.io/healthz` returns OK.
2. The glasses simulator shows "Say a price", not "Offline - retrying". If it shows a pairing code, the DB was reset: re-pair first.
3. Customer wallet balance check: the pay page does a pre-flight and refuses if there is not enough USDT or GRAM for gas (a failed send would waste a take).
4. Rehearse once and note the real time from "Pay" to PAID. The live-states run took 12 to 25 s on unauthenticated TON Center. Do not narrate a number you did not see. If it is slow, the dead air is real: cover it with the caption "waiting for the chain", do not cut it.
5. Voice: component-checked only, never through the simulator mic. Try the mic once before recording. If it fails, use swipe presets (Scene 3 gives both).

## Scenes

### Scene 1 · 0:00 to 0:15 · Something real, immediately

**On screen**
1. Tab A: glasses simulator showing `READY 12.00 USDT | waiting for payment...` (arm this before recording).
2. Cut in the phone: Telegram chat with a screenshot of a green "Payment successful 12.00" held up. Label it on screen: "customer's screenshot".

**Caption:** `"I already paid." (a screenshot)` then `Glasses: READY. Still waiting.`

**Say**
> "She says she paid, and she's showing me a screenshot. I can't tell if it's real. My hands are full. But my glasses can."

**Why:** the first 15 seconds carry the real product and the problem together. No logo, no intro.

### Scene 2 · 0:15 to 0:35 · Who it hurts

**On screen**
1. Hold on the glasses. Overlay three text cards, one per second pair: "Barbers. Coffee stands. Pop-up sellers." then "Fake payment screenshots are a named fraud." then "Shops pay monthly for a speaker that says 'you were paid'."

**Say**
> "Fake payment screenshots are a known fraud for anyone who sells face to face. Shops already pay monthly for a soundbox that announces payments out loud. Glasses have no speaker. ShopTill is the silent version: only I see it, and it reads the chain, not a bank message."

### Scene 3 · 0:35 to 1:00 · Say the price

**On screen**
1. Tab A: idle "Say a price". Tap, say "twelve". The simulator shows `READY 12.00 USDT`.
2. If the mic fails on the day: swipe to the 12 preset and tap. Caption `swipe presets also work`. Never fake the voice.
3. Cut to Tab B: the customer opens the counter link, the Mini App shows "Pay 12.00 USDT to <shop>".

**Caption:** `Say the price. Customer scans the counter QR in Telegram.`

**Say**
> "I say the price. The glasses arm a sale with its own reference. The customer scans my counter code and the Mini App opens in Telegram."

### Scene 4 · 1:00 to 1:45 · CLIMAX A: the screenshot does nothing, the chain does

**On screen**
1. Tab A, full frame, **hold completely still for 4 seconds**. Caption: `Screenshot sent. Nothing on chain. Still READY.`
2. Tab B/C: customer taps Pay, signs in Tonkeeper testnet. Keep the wallet confirmation on screen for two seconds.
3. Tab A: waits, then `PAID 12.00 USDT | from 0Q...`. Do not cut the waiting time. Caption while waiting: `waiting for the chain`.
4. Tab D: paste the hash from the bot receipt link into tonviewer and show the tx with 12 USDT to the seller address. Caption: `This is the transaction. Testnet.`
5. Tab A: tap. Cut to Tab B: the customer's Telegram shows the receipt with the tonviewer link.

**Say**
> "The screenshot changes nothing. The glasses stay on waiting. Now she pays for real, in her own wallet. The money goes straight to me, and only when the TON chain confirms it do my glasses say PAID. Twelve USDT, and here's the transaction. One tap and she gets a receipt in Telegram."

**Why stillness:** the viewer must see that nothing happens. Silence here is the setup for the payoff.

### Scene 5 · 1:45 to 2:25 · CLIMAX B: the look-alike token

**On screen**
1. Tab A: arm a new sale, `READY 12.00 USDT`.
2. Caption in a large banner: `INTENTIONAL ATTACK: attacker sends a look-alike USDT.` Say the word "attack" aloud so it is not read as a bug.
3. Tab G (terminal): run the attacker helper (staging below). It sends 12 of the **fake** "USDT" jetton to the seller's address with the correct sale reference.
4. Tab A: `(!) FAKE TOKEN - NOT PAID`, then `do NOT hand over goods`. Hold still 3 seconds.
5. Tab D: show the fake transfer on tonviewer next to the real one, and mark the two different jetton masters in the captions.
6. **Stop moving the mouse. Say the climax line. Stay silent one full second.**

**Say**
> "Scammers airdrop look-alike tokens. This is an attack, on purpose. A look-alike USDT, the right reference, the right amount. A naive watcher says PAID. My glasses say fake, not paid. The glasses believe the chain. Not the customer."

**Staging (read carefully):**
- The reference for a live sale is minted when the customer opens the Mini App. The attacker needs it: copy the `ref=` value from the Mini App URL (or the sale reference the bot shows), and the seller address from `/wallet`.
- The send logic already exists: `sendJetton(master, amountRaw, ref)` in `server/scripts/live-states.ts` and `packages/core/scripts/pay.ts`, using the fake master from `.secrets/testnet-jettons.json`. **A small CLI wrapper that takes the seller address and a ref and sends the fake jetton does not exist yet. Build it before recording** (`packages/core/scripts/fake-send.ts`, gitignored secrets only, no keys in the repo).
- **Fallback if the wrapper is not ready:** show the recorded 8/8 edge-state run. Label it on screen "recorded harness run, 2026-11-23, real testnet", show the FAKE row and open the transaction https://testnet.tonviewer.com/transaction/f6d75e2a8150d5fd7f26b42781d845646ae7b68740643aa3f767f761362038d1. Say "this was the same attack, run through the real service" so it is not passed off as live.
- Confirm the customer wallet holds at least 1 of the fake jetton (the live-states harness needs 1.00 fake USDT).

### Scene 6 · 2:25 to 2:45 · Proof, not claims

**On screen**
1. Tab F: the live-states table, 8 rows, hold 3 seconds. Caption: `8 of 8 edge states on real testnet`.
2. Quick cut to the repo README proof table. Captions: `11/11 spike`, `2,815 real mainnet payments, 0 false PAID`, `130 tests` (86 server, 21 glasses, 23 core).
3. Tab E: the first real owner payment (UAT 1) transaction.

**Say**
> "Eight of eight edge states passed on real testnet: short, extra, duplicate, fake, late, and more, each with a transaction. And I replayed 2,815 real mainnet payments to busy wallets, read only. Zero false PAID."

### Scene 7 · 2:45 to 2:55 · The honest close (stop on the last word)

**On screen:** Tab A, glasses showing the last PAID. Small caption: `Testnet demo. Never holds keys or funds.`

**Say**
> "This is a testnet demo. ShopTill never holds anyone's money. The customer pays the seller directly, and the glasses only tell the truth."

No outro card, no music sting, no thank-you slide.

## Spoken word count

About 380 spoken words across scenes 1 to 7. At a slow, confident 130 to 140 words per minute that is roughly 2:45 to 2:55 including the held silences. If a take runs over 2:55, cut Scene 2's third sentence first.

## Do not claim

- Do not say or imply a mainnet payment through ShopTill. The mainnet run was a read-only replay.
- Do not say it works on physical G2 hardware. It ran in the simulator.
- Do not say the seller is alerted when the glasses app is closed. The bot DM exists but is not tested on a live run.
- Do not give a latency number unless you saw it in this take. Say "when the chain confirms".
- Do not say Gram Wallet paid in the demo. Gram Wallet is mainnet only; the testnet customer is Tonkeeper testnet, connected with TON Connect.
- Do not say it integrates TON Pay or has paying customers. Pricing and TVM fit are plans.
- Do not present the fallback harness clip as a live attack.
- Do not claim an app that is "published" to the Even Hub store. `shoptill.ehpk` is packaged only.

## Claim to evidence

| Spoken or captioned claim | Evidence |
|---|---|
| Glasses stay on waiting with only a screenshot | State is recomputed from chain payments only; no endpoint writes state (`evidence/security-audit.md`, question 2); live in Scene 4 |
| A real payment flips to PAID | `evidence/uat-1-first-payment.md`, tx https://testnet.tonviewer.com/transaction/060c5dce548948be0a171a0f6002f40ae40987ae4293b1e2b45cc9d56efcaefc |
| Look-alike USDT with the right ref is FAKE | `evidence/live-states.md` row 5, tx https://testnet.tonviewer.com/transaction/f6d75e2a8150d5fd7f26b42781d845646ae7b68740643aa3f767f761362038d1; `evidence/p0-spike.md` row 11 |
| 8 of 8 edge states on testnet | `evidence/live-states.md`, "Result: 8/8 as expected." |
| 11/11 spike | `evidence/p0-spike.md`, "Correct: 11/11", max latency 3571 ms |
| 2,815 real mainnet payments, 0 false PAID | `evidence/real-input.md`, "PASS: no false PAID on 2815 real payments" |
| 130 tests | server 86, glasses 21, core 23 (run on 2026-11-23) |
| Never holds keys or funds | `evidence/security-audit.md`, question 6 |
| Receipt arrives in Telegram | `evidence/uat-1-first-payment.md` (`receipt_sent=1`), shown live in Scene 4 |
