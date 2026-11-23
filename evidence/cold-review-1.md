# Cold review 1 (hostile judge, public artifacts only)

Reviewed: README, FEATURE_REQUESTS, DEMO_SCRIPT, evidence/*.md, LICENSE, repo tree, screens.ts, server/src, apps/pay. `/healthz` returns `{"ok":true}`.

## Red-team rejection paragraph

ShopTill is a polished testnet payment classifier with a G2 skin, and it does not yet prove the thing it sells. (1) Cheapest dodge: nothing forces the customer through the Mini App. A buyer who pays from any wallet with no comment lands in UNMATCHED, and the seller is told to "tap: attach to open sale". In a busy shop the seller's only defence against attaching the wrong person's transfer is memory, and the README itself admits "every unrelated incoming transfer shows as UNMATCHED, by design". The headline "screenshots don't count" holds, but "the chain is the truth" does not identify who paid. (2) Wrong-party payoff: attach re-labels any unmatched same-shop payment to the open sale, so customer A's unrelated transfer (or a dust or spam sender) can be tapped into customer B's sale and release goods to B. The money is real but the party is wrong. EXTRA also shows "PAID" on an over-payment, which is fine, but DUPLICATE shows no refund path ("seller refunds by hand"). (3) Ordering and liveness: PAID takes 12 to 25 s in the only full-service measurement, over a 1.5 s tick on unauthenticated TON Center that returns 429s. A barista will not wait 25 s with a queue. The latency headline of 3.6 s is the matcher alone. Sale TTL is a fixed 15 minutes, and a payment 1 s after expiry is LATE. If TON Center is down, the till shows "Offline" with no fallback. (4) Security: three high findings in a day-one build (device auth, brute-forced pairing, remote crash) were found by the author's own audit. The fixes are claimed but the audit file still says "none of the fixes below is deployed yet", so the repo contradicts itself. D-2 (indexer-trusted jetton master) is the core of the FAKE claim and is unfixed, and the spike only proves a look-alike master is caught, not a look-alike wallet claiming a real master. The service runs as root. CORS is `*`. (5) No reason to return: the buyer must install Telegram, a TON wallet, hold USDT and gas, and connect TON Connect to buy a coffee. The customer gets nothing from this except a receipt. The seller side has a reason (fraud), but there is no customer-side pull and no merchant has been asked. (6) Unsupported claims: "0 false PAID on 2,815 real payments" is a replay with zero matching sales, so it can only show that nothing was falsely counted; it says nothing about true positives and the spam sample was "1 non-allowlisted jetton row" (4 in the table). It is evidence for "no false PAID" in a world where no PAID is possible. The per-USDT FAKE test uses a jetton the author minted. "Barista, barber" is asserted, never validated. (7) What happens on a real one: there is no mainnet payment, no physical G2 run, no real microphone run through the simulator, and "Glyphs are plain ASCII" because the author could not test the hardware. The one human run (UAT 1) was by the owner, in a simulator, with a jetton the owner minted. A judge cannot pay at all without contacting the author for test USDT. (8) Hand-written input before value: to try it the judge must run Vite, a simulator, a second Telegram account, a TON testnet wallet, test GRAM from a faucet, and ask the author for test USDT. That is eight steps before the first PAID. (9) Placeholder or stale on a public page: `git clone <this repo>` in Setup, the packaged `.ehpk` is the only artifact a judge can sideload and it points at one personal sslip.io IP-derived host, `evidence/security-audit.md` says "not deployed yet", and DEMO_SCRIPT.md still says the attacker CLI wrapper "does not exist yet" and still carries recording-staging notes. Verdict: strong engineering honesty, weak on the 30% usefulness and 25% read-and-write criteria because the glasses UX is three lines of ASCII driven mostly by a Telegram-wallet flow.

## Rubric scores

| Criterion (weight) | Score | Why | Single change that raises it most |
|---|---|---|---|
| Usefulness on G2 (30%) | 6 | The glasses glance is the right form factor (silent, private PAID), but PAID depends on the customer using a TON wallet and 12 to 25 s latency; nothing is shown on hardware. | Cut observed latency to under 5 s (TON Center API key, shorter tick, show a visible "seen on chain, confirming" step) and state the number measured. |
| Read & write (25%) | 7 | Say "twelve" or swipe a preset, tap to arm, tap for receipt: good phrase-to-action. Voice is untested through the real mic and the claim "twelve fifty" needed a prompt-bias patch. | Run the mic once through the simulator and record it; add "repeat last amount" as the default so a returning sale is one tap. |
| Technical execution (20%) | 8 | Pure classifier, 130 tests, 8/8 live states with tx links, audit with regression tests, deployed. Docked for D-2 unfixed and root service. | Add the on-chain `get_wallet_address` check for FAKE (closes D-2 and makes the headline claim true). |
| UX for 576x288 mono + voice (15%) | 5 | Three ASCII lines, no layout beyond text; glyph policy is "can't test", no progress or size hierarchy, hints are 40+ character strings (`tap: ok  \|  do NOT hand over goods`). | Shorten l3 hints and use the large status word alone for PAID/FAKE; one or two real G2 screenshots in the README. |
| Business & safety (10%) | 5 | Good safety posture and honest planning, but pricing is untested, no merchant contact, and TVM/TON Pay fit is positioning only. | One real merchant quote or a signed LOI-style note, even a single one. |

Weighted estimate: about 6.4 / 10.

## README overclaims, stale numbers, unclear steps (quoted)

- Line 3 / 9: "your glasses show PAID only when the TON chain confirms it. Screenshots don't count." True for the screenshot, but PAID also appears for an attached UNMATCHED payment (tap), which is a seller decision, not chain proof. Say "chain-confirmed amount, seller-attached when no reference".
- Line 15: "In India, merchants already pay a monthly fee ... (about Rs 125 to 150 a month per a 2023 BofA study, as cited in my research notes)". The source is "my research notes". A judge cannot check it. Cite a URL or drop the number.
- Line 15: "They pay just to be told 'you were paid', and that proves the habit." Overreach; the soundbox also provides settlement confirmation from the bank.
- Line 29: "The whole shop does not hear how much you charged." Fine, but untested on G2 and no photo.
- Line 36: "only then flips the glasses to PAID" while line 39 lists EXTRA showing PAID with an extra amount and UNMATCHED tap-to-attach. Be explicit.
- Line 50: "0 false PAID, 0 false FAKE" on a replay with no real sale and no fake sale in the traffic. It is a null result, not a precision result. The same row says "0 false FAKE" although the replay contained 4 non-allowlisted jettons (all IGNORED) and the README line 113 admits the spam sample was thin.
- Line 51 / 72: "Three high findings ... found, fixed and covered by tests". The audit file itself says "none of the fixes below is deployed yet" and "the deployed server is the old build". README only half-covers this with "the audit's live checks ran against the build deployed at that time". State plainly whether production now runs the fixed build (and when it was deployed).
- Line 72: "15 security regression tests" and line 153 to 155 "86 / 21 / 23 tests (all pass at time of writing)" versus DEMO_SCRIPT "130 tests" (86+21+23 = 130, ok) but the grep count of test cases in the tree is not trivially verifiable; add a CI badge or a printed run.
- Line 104: "ShopTill never holds keys or funds." Correct for customer funds, but the server holds a Telegram bot token and a Groq key and the seller's public address; a compromised server can swap the stored seller address (setup is owner-gated, but the pay page trusts the server). State this trust boundary.
- Line 113: "re-run scanned 2,815 real payments with 0 false PAID. The busiest wallet still exceeds 10 pages per 24 h, so that window is capped." Contradiction with the headline "(24 h)" in the table row at line 50: the window is not actually 24 h for the busiest wallet. Quote the real covered span.
- Line 114: "Gram Wallet is mainnet only." The Crypto & DeFi track is declared as "(main, Gram Wallet / TON)" on line 11 but no Gram Wallet payment appears in the evidence. Judges will read "main track: Gram Wallet" and see zero Gram Wallet. Reword the track claim.
- Line 115: "The bot is meant to DM the seller then. That DM path is implemented but not yet tested." Fine, but it is the answer to "what if the glasses are closed", the most likely judge question. Test it.
- Line 119: "You need no hardware." Then lines 121 to 125 need Node, a simulator, two Telegram accounts, a testnet wallet and the author's minted USDT. "No hardware" is not "no setup". Also step 4 ends with "contact me" which is a dead end for a judge. Offer a one-command mock/replay mode or a pre-funded demo wallet link.
- Line 134: `git clone <this repo> && cd shoptill` is a placeholder. Use the real URL.
- Line 143: "(default `http://localhost:8787`)" while line 138 says server `PORT` default 8799. Inconsistent defaults.
- Line 144: `node server/dist/server.mjs` and "Deploy ... esbuild bundle": the `npm run build -w @shoptill/server` output name is not verified here; confirm it matches the build script.
- Line 148: `.ehpk` whitelists only the author's sslip.io host. If the VPS or IP changes, the packaged app breaks. State this; a judge cannot point it elsewhere.
- Line 168: "Market signal (PROVEN as public reporting, not by me)". "PROVEN" is not the right word for a figure the author cannot source. Same for "(PLANNED)" labels used well elsewhere; keep those, drop "PROVEN".
- Line 169: "reads the chain instead of a bank callback" is a feature for TON-holding customers only; a soundbox works for the existing 99% of customers.
- Line 178: "at most 3.6 s ... 12 to 25 s" is honest but is the single biggest usefulness risk and sits in Limitations at the bottom. Surface it near the top.
- Line 182: "I have not run it on physical G2 hardware." This is an honest but costly sentence on a hardware hackathon. If any G2 or Even Hub phone session is possible before submission, do it.
- Line 5 headline links "Live server" to `/healthz`, which shows `{"ok":true}` and nothing else. Link to the bot or a status page instead.
- DEMO_SCRIPT line "Scene 5 staging": "A small CLI wrapper ... does not exist yet. Build it before recording". The script is public; either build it or move the note out.
- DEMO_SCRIPT: "Scene 1 (0:00 to 0:15)": the screenshot-on-phone shot is a strong open, but the voice-over says "my hands are full. But my glasses can" before the viewer has seen a glasses screen with PAID. Show the READY frame in the first 3 seconds, not after the screenshot.

## Biggest risk to placing

The judges (Even Realities, a G2 company) will rank on how the thing feels on the glasses. There is no hardware run, no real mic run, and the on-glasses UI is three ASCII text lines. Meanwhile the strongest asset (the classifier and its evidence) is not what the rubric weights most. Second risk: the demo needs a TON-wallet customer, which a TVM audience likes and an Even Realities audience may find a heavy lift for a coffee.

## Top 5 fixes ranked by score impact per hour

1. **Run it once on real hardware or the Even Hub phone app and record 20 s** (about 1 to 2 h if hardware access exists). Moves Usefulness and UX. If no hardware, add two simulator screenshots of PAID and FAKE to the README top and say so.
2. **Cut visible latency and show progress** (1 to 2 h): use a TON Center API key, drop the tick gap, add an intermediate "seen, confirming" screen, re-measure and put one honest number in the README header. Moves Usefulness and Business.
3. **Mic run through the simulator, recorded** (30 min). Moves Read & write (25%); the whole hands-free story is currently unproven at the real input.
4. **Reconcile the audit and README state** (30 min): update `evidence/security-audit.md` "not deployed yet" to the deployed fact with date, fix `git clone <this repo>`, make "Live server" link useful, fix the 8787/8799 inconsistency, remove "PROVEN". Cheap credibility; removes the obvious judge gotcha.
5. **Add the on-chain `get_wallet_address` FAKE check (D-2)** or, if short on time, add a seller-facing "who paid" cue to attach (show the sender short address and age, require the open-sale amount to match before the tap). 2 to 3 h. Moves Technical and Safety and removes the wrong-party attach scenario.

Also worth 15 min: replace "contact me" in step 4 of Try it with a pre-funded demo customer link or a one-command replay mode so a judge can see PAID without minting a jetton.

## Demo script: first 15 seconds

The concept is strong: a screenshot in one hand, a glasses frame saying READY and still waiting. That is a real moment and it names the problem without a logo. Weaknesses: (a) the spoken line "My hands are full. But my glasses can." arrives before the viewer has seen any glasses UI; (b) the first frame is a simulator window on a laptop, which reads as a prototype rather than a product on a wearer; (c) READY has to be pre-armed, so the viewer never sees the "say a price" action in the first 15 seconds, which is the "read and write" criterion at 25%.

What I would cut or change:

- Open with the glasses frame already showing `READY 12.00 USDT` for 2 seconds, with the first spoken words "Say a price." then the customer's screenshot, then "READY. Still waiting."
- Cut Scene 2 (who it hurts, 20 s) to one 6-second sentence, or fold it into Scene 1. Judges have the README; the video should show the product.
- Cut Scene 6's recitation of test counts (130 tests, 2,815 payments) to a single on-screen line with no narration.
- Do not narrate "No logo, no intro" or any "why" lines; they belong in production notes, not the video script.
- Do not let the fallback harness clip substitute for the attack in Scene 5 without a clear on-screen label, as the script already says. If the wrapper is not built, shorten the scene to 15 s and show the tonviewer link, not a long terminal.
- The 2:45 to 2:55 target with 380 words leaves no room for the real 12 to 25 s wait. Either budget it explicitly (jump cut with a clock overlay) or you will overrun the 3:00 hard limit.
