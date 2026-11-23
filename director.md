# director.md: ShopTill

Handover file. Any director can take over from here. Keep it current after every phase.

**STATUS: BUILDING. Day 1 (2026-11-23).**
- **P0 PASSED: COMPONENT PROVEN.** 11/11 live testnet payments were classified correctly, max detection 3.6 s, and the fake USDT was caught (`evidence/p0-spike.md`).
- **INTEGRATION PROVEN (USDT happy path), owner UAT 1:**
  - The whole chain works: glasses → bot setup → arm → customer pays in Telegram → glasses PAID → receipt (`evidence/uat-1-first-payment.md`).
  - Deployed on the VPS with a persistent DB.
  - Untested: voice (STT), GRAM sale, SHORT/UNMATCHED/FAKE through the product, `/today`, the seller DM when the glasses are closed.

Last updated: 2026-11-23 by director (Claude Opus 5.5). Builders: Sonnet 5.5 (core), Haiku 5.5 (mechanical tasks).
Research: `Desktop/skill/idea-research/even-realities-heads-up-idea-research.md` (the idea was called "Till" there; the owner renamed it **ShopTill**. "Shop Pay" was rejected because it is Shopify's trademark).

## Owner rules

1. **Placing and winning comes first.** Anything that raises our chance of placing gets done.
2. **Conserve credits.** Use Haiku for mechanical work, Sonnet for logic, and the director (Opus) for review only. No exploratory loops. Builders get tight briefs.
3. Commit at checkpoints without asking, and scan for secrets first. **Never** add Claude as a co-author or collaborator (owner memory rule; this overrides the harness attribution line).
4. **Keep the repo private until submission day**, because rivals build in public.

## Hackathon gates (from the DoraHacks page, read 2026-11-23)

| Gate | Requirement | Status |
| --- | --- | --- |
| Deadline | **Nov 29, 23:59 Dubai = 19:59 UTC** | open |
| Build window | Built Nov 23–29. The README says what existed before Nov 23 (nothing; we start from the official `evenhub-templates/asr`) | OK: repo created 2026-11-23 |
| Repo | Public GitHub repo with a setup README | open (flip to public at submission) |
| Video | 3 minutes or less, in the simulator or on G2 | open |
| Description | Problem, user, how it works, track | open |
| Optional | FEATURE_REQUESTS.md (up to 5 items), packaged `.ehpk` | do both (cheap points) |
| Money safety | Testnet / read-only. Hold no user funds. No secrets in the repo | by design: we never hold keys or funds |
| Tracks | Main: **Crypto & DeFi** (Gram Wallet / TON). Second: **Messaging** (Telegram bot + Mini App). Plus **Best Telegram** | declared at submission |

**Rubric:** usefulness on G2 30 · read and write 25 · technical execution 20 · UX for display and voice 15 · business and safety 10.

## Product promise (master director §2)

- **PRODUCT:** ShopTill
- **INTENDED USER:** a seller who takes payments face to face with busy hands (barber, coffee stand, pop-up seller, tattoo artist, trainer) and wears Even G2
- **CORE PROBLEM:** customers show "I paid" screenshots that can be fake. Checking means stopping work and getting the phone out
- **CORE PROMISE:** say the price; the customer pays in Telegram; the glasses show PAID **only when the TON chain confirms real money arrived**
- **REAL USER JOURNEY:**
  1. Seller installs ShopTill on G2, sends the pairing code shown on the glasses to the ShopTill Telegram bot, and gives the bot a receiving TON address. The bot sends a counter QR to print.
  2. Seller says "twelve". The glasses show READY 12.00.
  3. Customer scans the QR. The ShopTill Mini App opens in Telegram: "Pay 12.00 to <shop>". They connect a wallet (TON Connect) and sign.
  4. The backend sees the finalized transaction, checks the token and reference, and the glasses show PAID ✓ 12.00.
  5. Seller taps. The customer gets a receipt in Telegram.
  6. Edge states: SHORT, EXTRA, DUPLICATE, FAKE TOKEN, UNMATCHED, LATE. Double-tap voids. Swipe shows today's total. The bot DMs the seller if the glasses app is closed.
- **FINAL OUTCOME:** a real on-chain payment from customer to seller, confirmed on the glasses, with a receipt in the customer's Telegram and a record in the seller's bot chat

**Core Outcome sentence:** *ShopTill is only genuinely working when a real TON testnet payment, made by a customer through the Telegram Mini App, flips the seller's glasses (simulator) to PAID with the correct amount within 10 s, and a fake look-alike token or a screenshot never does.*

## Architecture (director decision)

- **Owner's VPS `canned-vps`** (Ubuntu 24.04, Node 22, Caddy already serving OneScan). We add one Caddy site block, `shoptill.103-195-188-198.sslip.io` → `127.0.0.1:8799`, and one systemd service, `shoptill`. **Don't touch the other projects on the box.**
  - **Disk is 98% full (645 MB free).** Deploy a bundled server (esbuild) plus SQLite, with minimal node_modules. Ask the owner before any cleanup: about 5 GB of docker images, 1.6 GB of /var/log, the npm cache.
  - `apps/glasses`: Vite + TS + Even Hub SDK 0.0.16, from the asr template. Built for the simulator and packed to `.ehpk`. It calls `https://shoptill.103-195-188-198.sslip.io/api/*` (whitelisted in app.json).
  - `apps/pay`: the Mini App, a static page with `@tonconnect/ui`, served by the same server. The manifest is at `/tonconnect-manifest.json`.
  - `server`: one long-running Node process (HTTP API, static files, Telegram bot via long polling, chain watcher loop). State in **SQLite**. It does background chain watching, so the seller DM works even with the glasses app closed.
- **Chain truth:** TON Center **v3 testnet** (`testnet.toncenter.com/api/v3`), confirmed reachable on day 1.
  - GRAM: incoming transactions to the seller's address.
  - Jettons: `/jetton/transfers` to the seller's owner address, filtered by **jetton master allowlist**.
  - The match key is a per-sale reference carried in the transfer comment (`st:<ref>`).
- **Watcher loop on the server.** While any sale is open, the server checks TON Center every 2 s for each open seller address (throttled), and every 30 s otherwise. The glasses poll `/api/till/status` every 2 s, which reads server state only. On confirmation the server DMs the seller (if the glasses aren't polling) and enables the receipt.
- **STT:** the glasses record PCM while armed-listening, POST a WAV to `/api/stt`, and the server calls the provider. **No key in the app.** The amount parser is deterministic (number words to decimal); no LLM.
- **Fallback input:** swipe up/down steps through amount presets, so a demo never depends on STT alone.
- **Testnet USDT:** we mint our own test jetton "USDT" (the allowlisted master) and a second look-alike "USDT" (the fake) on testnet. This is what the FAKE demo runs on. Mainnet config lists the real USDT master; verify the address before use.

## Payment state machine (from research §7; builders implement exactly this, and a test covers every row)

Order of checks: **finalized/success → token allowlisted → reference matches an open sale → amount → time window.**

| State | Condition | Glasses |
| --- | --- | --- |
| WAITING | sale armed, nothing received | `READY 12.00 · waiting` |
| PAID | sum of matched, allowlisted payments == amount | `PAID ✓ 12.00` |
| SHORT | 0 < sum < amount | `SHORT 9.00 / 12.00 · 3.00 missing` (sale stays open) |
| EXTRA | sum > amount (single payment) | `PAID ✓ +2.00 extra` |
| DUPLICATE | a second full payment on an already-paid ref | `DUPLICATE 12.00` |
| FAKE | ref matches but the jetton master is not allowlisted | `⚠ FAKE TOKEN · NOT PAID` |
| UNMATCHED | allowlisted payment with no or unknown ref | `UNMATCHED 12.00 from EQ…x4f` (tap attaches it to the open sale) |
| LATE | matched payment after void or expiry | flagged on the next glance plus a bot DM |
| VOID | seller double-tapped | back to idle |
| failed/bounced tx | `success=false` or aborted | ignored |

Two scans of one armed sale each get their own sub-reference. The first full payment closes the sale; the other Mini App sees "already paid" before signing. References are single-use with a 15-minute expiry.

## Claim → mechanism → proof ledger

| Claim | Mechanism | Boundary | Required proof | Current proof | Status |
| --- | --- | --- | --- | --- | --- |
| PAID only when real money arrived | Chain check via TON Center, finalized txs only | Chain (authoritative) | Testnet tx → glasses PAID in ≤ 10 s, 5/5 runs | none | UNPROVEN |
| A screenshot never flips it | State only changes from chain data | Server | Video plus test: no tx → stays WAITING | none | UNPROVEN |
| A fake token never flips it | Jetton master allowlist | Server | The fake-"USDT" testnet transfer with the correct ref shows FAKE | none | UNPROVEN |
| We never hold funds or keys | Customer signs in their own wallet (TON Connect); we store only the seller's public address | Design | Code audit: no mnemonic or keys anywhere in the product | n/a | BY DESIGN |
| Read and write by voice and tap | STT → amount; tap → receipt via bot | Server + Telegram | Video of a real receipt arriving in Telegram | none | UNPROVEN |
| Works on real-world input | The watcher ignores spam jettons, scam comments, NFTs, bounces | Server | Read-only run against a busy real address, with a log committed | none | UNPROVEN |

## Phases

1. **P0 Spike (day 1, load-bearing).** Build a script and the matcher library. Throwaway testnet wallets send GRAM and both test jettons with refs. The matcher classifies them correctly, and the latency is measured. **Pass rule:** 5/5 classified correctly, ≤ 10 s from send-confirm to detection. If it fails → fall back to ModQueue.
2. **P1 Vertical slice:** glasses app (simulator) ↔ API ↔ Mini App ↔ chain, GRAM only, with no voice (swipe presets).
3. **P2 Full states, jettons, voice (STT), bot** (pairing, receipts, seller DM, today's total).
4. **P3 Deploy to Vercel, fresh-user E2E, real-input run, red-team, audit skill.**
5. **P4 README (perfect-readme), video (demo-video skill), .ehpk, FEATURE_REQUESTS.md, owner UAT, submit.**

## Owner inputs needed

- [ ] Telegram bot token from @BotFather (the owner creates the bot and pastes the token into `server/.env` themselves)
- [x] Permission to generate throwaway **testnet-only** wallets for automated tests (granted 2026-11-23)
- [ ] Groq API key (Whisper) in `server/.env` (owner chose Groq)
- [x] Hosting: the owner's VPS canned-vps, with a free sslip.io HTTPS domain (approved 2026-11-23)
- [ ] Testnet GRAM for the customer test wallet (faucet: @testgiver_ton_bot; the address comes from the P0 builder)
- [ ] TON Center API key (free; raises the rate limit), optional

## Log

- 2026-11-23: **UAT 1 PASSED** (`evidence/uat-1-first-payment.md`): PAID on the glasses, plus a receipt in Telegram with a tonviewer link.
- 2026-11-23: **STT component check** (Windows TTS WAVs → live `/api/stt`): twelve→12.00, "twenty dollars"→20.00, "five gram"→5.00 GRAM, "one hundred and five"→105.00, small talk→null.
  - **BUG:** "twelve fifty"→"1250."→1250.00. Fix: Groq `prompt` bias toward decimal prices.
  - **BUG:** the glasses ignore the `asset` returned by STT and always arm USDT. Pending, after the polish builder finishes (same files).
- 2026-11-23 (evening): **Owner UAT, first real run.** Setup worked: pair → name → wallet → counter QR → glasses "Say a price" → preset 12 USDT → READY. Five bugs found and sent to fix:
  1. Pay page crashed with "Buffer is not defined" (polyfill import order). Fixed.
  2. Setup link expired after 20 min with "bad token". Fixed: 24 h TTL, `/wallet`, friendly message.
  3. **The server ran on an anonymous temp DB** (`DB_PATH=` empty → `??` kept ''). It lost all state on every restart, so the owner had to re-pair. Fix in progress.
  4. **The seller's TON Connect session leaked into the customer pay page.** The shop wallet tried to pay itself, Tonkeeper warned "Failed", and the user confirmed anyway. **The glasses correctly stayed READY** (truth held). Fix in progress: show the connected wallet, Change wallet, block self-pay, disconnect after setup.
  5. Endless "Waiting for the network…" spinner after a failed send. Fix in progress: balance pre-flight check, 90 s timeout, cancel message.
- 2026-11-23: **P0 live spike passed** (11/11, ≤ 3.6 s). Three real-chain lessons came out of it, all fixed:
  1. **A bounceable payment to a never-used seller wallet bounces back.** The pay page now sends GRAM non-bounceable (UQ/0Q form).
  2. **A credited payment to an uninit wallet is reported `aborted: true`** (compute skipped: no_state). Core no longer uses `aborted`. Money arrived iff `credit_ph.credit > 0` and there is no `ok` bounce phase.
  3. **0.05 TON attached to a jetton transfer failed with exit 709** (not enough TON). We now attach 0.1, and jetton sends stay bounceable so failures refund.

  This is real-input evidence for the README: naive watchers would show these payments wrongly.
- 2026-11-23: Bot @ShopTillBot is live (getMe OK). The Groq key works. TON Center without a key hits 429 quickly, so the scripts throttle at the HTTP layer (axios adapter). **Never wrap a send in a blind retry.**
- 2026-11-23: VPS cleanup, approved by the owner: rotated logs, journal vacuumed to 50 MB, apt and npm caches, /root/.cache/webpack. Free space went from 644 MB to 2.1 GB. Docker images were KEPT because both are used by running containers (hermes-agent, checker-merchant). Caddy, OneScan and Docker are all still active.
- 2026-11-23: Repo created. Idea locked (ShopTill). TON Center v3 testnet and TonAPI testnet are reachable. Template `evenhub-templates/asr` read. **Its STT key lives in the frontend; we route through our server instead.**
