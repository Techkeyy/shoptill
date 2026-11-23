# ShopTill security audit (2026-11-23)

Scope: `server/src`, `apps/pay/src`, `apps/glasses/src`, `packages/core/src`, `server/deploy`, `.gitignore`, git history, `evidence/`.
Live checks were read-only `curl` against the public endpoints. Nothing was changed on production, and none of the fixes below is deployed yet.

## Method

**Audit skill (`project-audit`)**
- Phase 0: listed the checkable claims. "We hold no keys", "PAID only from chain data", "tokens are signed and expiring", "no secrets in the repo".
- Phase 1: hygiene greps for secrets, `eval` and string-built SQL, plus a read of the tracked file list.
- Phase 2: `.gitignore` coverage and a `git log -p --all` history grep for tokens, mnemonics and key shapes.
- Phase 3: claims against reality. Public endpoints were curled for CORS, traversal and auth behaviour. The "aborted request cannot crash the server" claim was tested with a reproduction.
- Phase 4: tried to break it with composed attacks. Each became a regression test in `server/src/security.test.ts`.
- Phase 5: this report, with confidence labels.

**Critical-bug-hunter**
- Phase 0: promise and invariants. A stranger must not control another seller's till. PAID must come only from chain data. A customer's money must not be redirected.
- Phase 2: authority matrix, below.
- Phase 3: state machine, including the transitions `attach`, `void` and `LATE`.
- Phase 6: multi-seller collisions (shared chain fake, cross-shop refs).
- Phase 13: authentication versus authorization. Telegram initData proves who a user is, not which shop they may change.
- Phase 15: security red team.
- Phase 16: tests of the tests. The old suite never presented a device credential, never aborted a request and never brute-forced a code, so all three of the high findings passed every test.

Confidence key: **[T]** reproduced or covered by a new automated test. **[C]** confirmed by reading the code. **[L]** confirmed against the live public endpoint. **[U]** not verified.

### Authority matrix

| Concept | Authoritative source | Secondary copies / drift risk |
| --- | --- | --- |
| Payment state (PAID etc.) | TON Center finalized txs, classified by `core/match.ts` | The `sales.state` column is a cache recomputed every tick. No endpoint writes it. |
| Who may control a till | Device secret (new), held by the glasses | The `deviceId` was the only credential before the fix. |
| Which shop a chat owns | `shops.seller_chat`, set by `linkCode` | The signed setup token carries `chat` and `shop`. It is now cross-checked. |
| Seller destination address | `shops.address`, written only via `/api/shop/address` | The pay page reads it from `/api/pay/info` and never from the URL. |
| Customer identity on the pay page | Telegram initData HMAC plus the signed token's `chat` | Both must agree. |

## Findings

| ID | Sev | Where (pre-fix) | Exploit scenario | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| S-01 | **High** | `service.ts` `pair`, `deviceShop`; `api.ts` device routes | **A stranger could control a till with just the deviceId.** The deviceId travelled in query strings (`/api/till/status?deviceId=`), which proxies and logs retain, and it was the only credential. Anyone who learned it could arm or void sales, send receipts, attach payments, read status and today's total, and call `/api/stt`. A UUID is unguessable, but it leaks. **[T]** | The server mints a random 192-bit device secret at first pair and returns it once. Only its SHA-256 is stored. Every device call needs the `x-device-secret` header, checked with `timingSafeEqual` and the same 403 for unknown and wrong. A paired device cannot be re-paired without the secret. The glasses store the secret in bridge localStorage. Legacy rows get one on their next pair. | Fixed |
| S-02 | **High** | `service.ts` `linkCode`, `bot.ts` code handler | **An attacker could link their own chat to someone else's glasses.** The code was `TILL-` plus 4 digits (9,000 values). It never expired and there was no rate limit. Sending `TILL-0000` through `TILL-9999` to the bot linked the attacker's chat, shop name and wallet address to the victim's glasses, so the victim's sales would pay the attacker. The attacker only needs a window while the victim's glasses show an unlinked code. **[T]** | The code is now 6 digits and expires after 30 minutes (the glasses refresh it on their next pair call). A chat is locked out after 5 wrong codes per 10 minutes, and there is a global budget of 100 wrong codes per 10 minutes. Locked-out attempts do not touch the DB. | Fixed |
| S-03 | **High** | `main.ts` `createServer` handler | **Remote crash.** A client that aborts mid-body made `for await (const c of req)` throw. The handler was async with no try/catch, so Node 22 killed the process. A malformed request URL did the same. Reproduced with the old pattern: the process exited with an uncaught error. systemd restarts it after 3 s, so a loop of aborts keeps the till and bot down. **[T] by reproduction** | Handler wrapped in try/catch (400 or destroy), plus a process-level `unhandledRejection` logger. The server now binds 127.0.0.1 only (see S-06). | Fixed |
| S-04 | Medium | `api.ts` `stt` | `/api/stt` only checked that a `deviceId` string was present. It did not check that the device exists, so anyone could burn the Groq key and quota with a made-up id. **[C]** | Needs device auth, plus 12 requests/min per device (429). | Fixed |
| S-05 | Medium | `POST /api/device/pair` | Unauthenticated and unlimited. Each call with a new id inserts a DB row, so the SQLite file can be inflated without bound. | 120 requests/min per client IP (429). Behind Caddy the IP comes from `x-forwarded-for`. | Fixed (bounded growth, not zero) |
| S-06 | Medium | `main.ts` `server.listen` | It listened on all interfaces. If the VPS firewall allows 8799, a client could skip Caddy and spoof `x-forwarded-for` to dodge the IP limits. **[U]** firewall state not checked. | `listen(port, '127.0.0.1')`. Caddy proxies to 127.0.0.1, so nothing else changes. | Fixed |
| S-07 | Low | `service.ts` `receipt` | A double tap sent two receipts to the customer: `receipt_sent` was set after the awaited Telegram send. **[T]** | The row is claimed before the send and released if Telegram fails. | Fixed |
| S-08 | Low | `api.ts` `/api/shop/address` | The signed setup token's `shop` was never cross-checked against `shops.seller_chat`. It only mattered if a token were ever minted wrongly, so this is defence in depth. **[T]** | Reject unless `shop.seller_chat === token.chat`. | Fixed |
| S-09 | Low | static and API responses | The Mini App URL carries the signed token in `?t=`, and there was no `Referrer-Policy`, so the token could leak through Referer to a wallet or modal origin. No `nosniff` either. **[L]** | `referrer-policy: no-referrer` and `x-content-type-options: nosniff` on every response. | Fixed |
| S-10 | Low | `server/deploy` | `.env` permissions were not enforced (the deploy script never touched them) and the unit has no hardening. **[U]** I did not SSH to production to check actual modes. | `deploy.sh` now `chmod 600 /opt/shoptill/.env`. The unit gets `NoNewPrivileges` and `PrivateTmp`. It still runs as root; moving to a dedicated user needs a DB path chown on the VPS, so left to the owner. | Partially fixed |

### Disclosed limitations (not fixed; each over about 20 lines, or a product decision)

| ID | Sev | Description |
| --- | --- | --- |
| D-1 | Medium | **Dust or UNMATCHED griefing.** Anyone can send a tiny allowlisted payment, or a payment with no comment, to a seller's public address. The glasses then show UNMATCHED instead of WAITING and the seller gets a DM. It cannot cause PAID, because money did arrive and the seller chooses whether to attach it. A minimum-amount threshold for UNMATCHED would fix it, but it is a UX decision. |
| D-2 | Medium | **Trust in the indexer.** FAKE-token protection compares the `jetton_master` that TON Center reports with the allowlist. If the indexer ever accepted a malicious jetton wallet that claims a genuine master, it would be classified as genuine. Closing this needs an on-chain `get_wallet_address` check against the master, a new RPC dependency. The P0 spike proves the look-alike master is caught, not this adversarial case. |
| D-3 | Low | `t.me/ShopTillBot?start=shop_N` uses sequential ids. Anyone can enumerate shop names and armed amounts, and each tap mints a `refs` row. This is public by design (the QR), but it is a mild info leak and a small DB-growth vector. A per-chat limit would fix it. |
| D-4 | Low | initData is accepted for up to 24 h (`maxAgeSec`). Pay tokens live 20 min and setup tokens 24 h, and both are bound to one Telegram user, so a leaked URL is useless to anyone else. |
| D-5 | Low | CORS is `*` and there is no CSP or `frame-ancestors` on the Mini App. Auth is by header or token and no cookies exist, so CORS `*` does not enable cross-site session riding. Clickjacking of the pay page is theoretically possible, but Telegram's web client embeds it in an iframe, so a strict `frame-ancestors` is unsafe to add blindly. |
| D-6 | Low | The device secret sits in plaintext in the Even Hub bridge localStorage, the same trust level as the old deviceId. Legacy devices get their secret on first contact (trust on first use), so a rollout window exists for already-paired devices whose id someone else already knew. |
| D-7 | Low | `/api/pay/jetton-wallet` and `/api/pay/balance` proxy TON Center for any authenticated Telegram user, so they can spend the shared TON Center rate budget. The jetton master is forced server-side to the sale's allowlisted master (verified), and a fake master cannot be passed. |
| D-8 | Low | The customer jetton-wallet address comes from TON Center, not recomputed from the master. If TON Center were hostile, the worst case is the 0.1 GRAM gas attachment going to a wrong contract. The jetton amount and the seller destination (server-supplied) are unaffected. |

## Answers to the focus questions

1. **Can a stranger control another seller's till?** Before the fix, yes if they learned the deviceId (S-01), and they could hijack an unlinked pairing by guessing the code (S-02). After the fix, neither works: the secret is required and codes are 6 digits, expire, and are rate limited per chat and globally. The deviceId is no longer a credential.
2. **PAID without real money?** No path found. State is recomputed from stored chain payments in `evaluate`, and no endpoint writes `state`. `attach` only re-labels an existing unmatched payment of the same shop. It is blocked for already-attached payments because the lookup requires `sale_id IS NULL`, and it re-runs the full classifier, so an attached fake-token payment becomes FAKE and a wrong-asset payment stays UNMATCHED **[T]**. Refs from another shop's sale never count (`s.shop_id === shop.id` in `ingest`) **[T]**. Replay of a payment across sales is impossible because of the unique `tx_hash` primary key and the single `sale_id`.
3. **Redirect a customer's money?** The seller address comes from the server (`payInfo`, from `shops.address`) and never from URL parameters. The query string supplies only `ref` and `t`, and both are verified server-side (token and ref must match, and initData must be for the token's chat). The amount comes from the server. The jetton master is forced server-side to the sale's allowlisted master. The setup address can only be set by the owning chat (S-08, plus the HMAC and initData checks).
4. **Telegram auth.** The HMAC is the standard WebApp scheme (`WebAppData` key, sorted data-check-string, `hash` excluded, `signature` included), compared with `timingSafeEqual`. `auth_date` must be within 24 h and no more than 300 s in the future. Wrong bot, tampering and staleness are rejected by existing tests. Tokens are signed with an HMAC key derived from the bot token, carry `exp` and `k`, and are bound to chat and ref. **Another shop's address cannot be set**: the token needs both a valid signature and matching initData for the owning chat (S-08 added the shop-owner cross-check).
5. **Static, CORS, errors, SQLi.** Path traversal: `resolve` plus a prefix check, and `URL.pathname` collapses dot-segments. Tested with `..`, `%2e%2e`, `%2f`, backslash, double slash and null byte **[T]**, and against the live server **[L]**. Every query is parameterized (`prepare` with `?`) and no SQL is built from user input **[C]**. Errors: 500 returns a generic `internal error` **[T]** and 4xx messages are fixed strings. The bot token never reaches logs (Telegram errors carry only the method and description). CORS is `*` (D-5). Secrets: none in the repo or history (below).
6. **Money-holding basics.** The product code contains no keys or mnemonics **[C]** (grep of `server/src`, `apps/*`, `packages/core/src`). The only `mnemonic` / `secretKey` uses are in `packages/core/scripts/*` and `server/scripts/live-states.ts`, which are dev-only and read from `.secrets/`, a gitignored directory. The mnemonics were never committed.

## Verified safe

- **Git history:** the `git log -p --all` grep for Telegram token shapes, `gsk_` Groq keys, private-key headers and mnemonic literals found nothing. Only the dev scripts mention mnemonics, by reading `.secrets/wallets.json`.
- **Gitignore:** `.gitignore` covers `.env*` (except `.env.example`), `.secrets/`, `evidence/*.db` and `*.db-*`. `git check-ignore` confirmed it. `.env.example` has only empty keys.
- **Evidence files:** they contain only testnet addresses, a tx hash and master addresses, which are public data. No secrets.
- **Live public endpoints:** `/healthz` 200, manifest correct, unauthenticated `/api/till/status` returns 403, `/api/pay/info` returns 401, traversal attempts return 404, and the OPTIONS preflight works. These are the pre-fix server.
- **Payment classifier:** ordering success, allowlist, ref, amount, time. Sub-refs and DUPLICATE are covered by the existing 22 core tests.
- **Concurrency:** one process with synchronous SQLite, so no cross-request races beyond S-07. The watcher is re-entrancy guarded.
- **XSS on the pay page:** every dynamic string is passed through `esc()` (shop name, amounts, errors).
- **Self-pay and customer-wallet guards:** the pay page blocks the seller's own wallet and checks the chain.

## Not verified

- **Production:** the deployed server is the old build, and `.env` mode, the VPS firewall and the Caddy access-log settings were not checked (no SSH, per the brief).
- **TON Center:** I did not test the adversarial fake-wallet case (D-2).
- **Tooling:** no dependency CVE scan was run, and no fuzzing.

## What this audit changed (code)

- `server/src`: `service.ts`, `api.ts`, `bot.ts`, `db.ts` (a migration adds `secret_hash` and `code_at` to `devices`), `main.ts`, and the new `ratelimit.ts`.
- `apps/glasses/src`: `api.ts`, `main.ts`, `mock.ts`, plus `API.md`, kept in sync.
- `server/deploy`: `deploy.sh` and `shoptill.service`.
- Tests: `service.test.ts` updated for the 6-digit code and the device secret, new `server/src/security.test.ts` (15 tests), new `apps/glasses/src/api.test.ts` (2 tests).

**Deploy note:** the server and the glasses app must ship together. The new server rejects calls that lack the secret, and the glasses recover automatically: a 403 sends them to `pair`, which issues the secret to a legacy device. The first request after the upgrade shows a brief "Offline" flash.
