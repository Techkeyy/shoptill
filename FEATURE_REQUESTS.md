# Feature requests

Five things the platforms were missing while building ShopTill (Even G2 + Even Hub, Telegram and Gram Wallet, TON Center). Each one cost real time or forced a workaround.

## 1. Even Hub: a way to notify the wearer while the app is closed

**Request:** a notification or background-event API (even a single-line toast) that a backend can trigger for a paired app.
**Why it mattered for ShopTill:** the whole point is that the seller learns "PAID" the moment money lands. Only one app is on screen at a time and nothing runs in the background, so a payment that arrives while the glasses are showing another app is invisible. We fall back to a Telegram DM from the bot, which means picking up the phone, the exact thing the product is meant to avoid.

## 2. Even Hub: on-device speech-to-text, or an official STT path

**Request:** a built-in STT call on the bridge, or a documented, keyless STT service for apps.
**Why it mattered for ShopTill:** the asr template keeps the STT key in the frontend bundle. For a payments app that is not acceptable, so we record PCM on the glasses and post a WAV to our own server, which calls Groq Whisper. That adds a server hop, a third-party dependency and a quota to protect (we rate limit 12 requests per minute per device and 30 per minute per IP). Voice is how the seller arms a sale hands-free, so it matters.

## 3. Even Hub: a published glyph and font reference for the 576x288 display

**Request:** a list of supported glyphs (check mark, warning sign, middle dot, ellipsis) and the available text sizes per container.
**Why it mattered for ShopTill:** our status screens want a check mark and a warning sign. The design guidelines do not list them and unsupported characters are silently dropped, so we ship plain ASCII (`(!)`, `|`, `...`) and cannot say whether a check mark would render on hardware.

## 4. Telegram Gram Wallet: a testnet and a payment link that can carry a reference

**Request:** a testnet mode for Gram Wallet, and a payment deep link (for example `t.me/sendgrams`) that accepts a comment or reference parameter.
**Why it mattered for ShopTill:** Gram Wallet is mainnet-only, so our demo runs on TON testnet with Tonkeeper testnet instead, and we cannot show the track's headline wallet paying on testnet. As far as we could find, the send link has no comment parameter, so a payment started from it cannot carry the per-sale reference ShopTill matches on. We route customers through a Mini App with TON Connect, which does let us attach the reference, but a plain link would be simpler for sellers and customers.

## 5. TON Center v3: jetton transfer records that prove the jetton wallet belongs to the master

**Request:** include a verified flag (or the computed jetton wallet address for the owner and master) on `/jetton/transfers` rows, so clients can tell a genuine USDT wallet from a contract that merely claims the master.
**Why it mattered for ShopTill:** FAKE-token protection compares the jetton master that the indexer reports against our allowlist. If the indexer ever accepted a malicious jetton wallet that claims a genuine master, we would classify it as genuine. Closing that gap needs an extra `get_wallet_address` call per payment, another RPC dependency and more rate-limit pressure. This is listed as D-2 in `evidence/security-audit.md`. Related: unauthenticated TON Center hits 429 quickly, so our scripts throttle requests. The live-states latencies (12 to 25 seconds) include that throttle and a tick gap, unlike the 1 to 4 seconds measured in the P0 spike.
