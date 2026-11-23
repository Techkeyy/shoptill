# UAT 1: first end-to-end payment (owner, 2026-11-23)

Tested by the owner (phone: Telegram + Tonkeeper testnet) with the director driving the glasses simulator against the live VPS server.

| Step | Result |
| --- | --- |
| Glasses show pairing code; owner sends it to @ShopTillBot; names shop; connects Shop wallet via TON Connect | PASS (counter QR received) |
| Glasses switch to "Say a price"; preset 12.00 USDT armed | PASS: `READY 12.00 USDT · waiting for payment...` |
| Customer opens counter link, taps Pay, pays 12 test USDT from the Customer wallet in Tonkeeper | PASS |
| Pay page shows `Paid ✓ 12.00 USDT`; bot message edited to "Paid ✓" | PASS |
| Glasses show `PAID 12.00 USDT · from 0QA4…sO5` | PASS |
| Tap on glasses → receipt sent to customer | PASS (`receipt_sent=1`) |

Chain proof (testnet): tx `BgxdzlSJSL4KFxoPYAL0CuQJh65Ck7HitFzJ1W78rvw=`, sale `1285ylnu`, ref `p4s8wp9s`, 12.000000 USDT (allowlisted test master `kQDT4p-DQndltAR_kEYzCoXO6IDlWXgmXYnolq21zxaYjEXT`) from `0QA4Bsge…AsO5` to `0QDAX4h7…sGmu`.

Earlier attempt in the same session: the shop's own wallet (leaked TON Connect session) tried to pay itself and Tonkeeper reported "Failed". **The glasses stayed READY (truthful).** The pay page now blocks that case.

Open polish items found: "299s ago" counts from sale creation, not payment; receipt screen second line not shown; first swipes after pairing are swallowed.
