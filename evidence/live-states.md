# Live edge states (real TON testnet, real server service)

Run: 2026-11-23T19:19:35.541Z. In-process server/scripts/live-states.ts; fresh SQLite, TON Center v3 testnet, Telegram faked (no token).
Seller: 0QDAX4h7qA6UcvNHBYtQ7m3OGDconur0DytMFD-JA0GXsGmu. Customer: 0QA4Bsge9Ja6LiIBPkFZBz0ZGS49AYWMmPK1WSPLc1fxAs05. Allowlisted USDT master: kQDT4p-DQndltAR_kEYzCoXO6IDlWXgmXYnolq21zxaYjEXT. Fake master: kQBsPFfpUnjPLYD4C_TmH19xyIejkTvYhIitFgxkMk9ymW2b.
Latency = send accepted and seqno consumed -> service reached the expected state (includes request throttle and 1.5 s tick gap).

| # | case | expected | observed | ok | latency ms | txs |
|---|---|---|---|---|---|---|
| 1 | PAID: USDT exact 1.00 | PAID | PAID | yes | 12680 | [14cc2273](https://testnet.tonviewer.com/transaction/14cc22735119d0be0266a76ba1e516ce651a8f7a022952a4337bf1ecc11534a5) |
| 2 | SHORT then top-up: 0.40 + 0.60 of 1.00 (SHORT seen after 13960 ms) | PAID | PAID | yes | 12482 | [bdac07dd](https://testnet.tonviewer.com/transaction/bdac07dd5055ec0ba6cc51e1bb37ba7318dbb06cc4601baf2d69e471a0262758) [832f8d2c](https://testnet.tonviewer.com/transaction/832f8d2cdbe34b41a26952abd31cef2ec17c4194f9658a58e4a908123613d83b) |
| 3 | EXTRA: 1.30 for 1.00 | EXTRA | EXTRA | yes | 13949 | [1d72dcf8](https://testnet.tonviewer.com/transaction/1d72dcf8fdb7fa2ac010ae61450362b70bdaaae897cce48801df94ba2a5e5db0) |
| 4 | DUPLICATE: two full payments, two refs | DUPLICATE | DUPLICATE | yes | 25215 | [83f521e9](https://testnet.tonviewer.com/transaction/83f521e98c1a097a2c44e6feac5c207221660b27e3ed6c294a8685da8cb35b30) [4bbc4804](https://testnet.tonviewer.com/transaction/4bbc4804e644d194211cdfb431327d490934e196d727e91a357fcf0dfb06a909) |
| 5 | FAKE: look-alike USDT with valid ref | FAKE | FAKE | yes | 12466 | [f6d75e2a](https://testnet.tonviewer.com/transaction/f6d75e2a8150d5fd7f26b42781d845646ae7b68740643aa3f767f761362038d1) |
| 6 | UNMATCHED (no comment) then attach (UNMATCHED seen after 12537 ms, then attach via service) | PAID | PAID | yes | 12537 | [ec1bc77d](https://testnet.tonviewer.com/transaction/ec1bc77d3179ad0f7ecaf4c8f3cc3e444ee154e6812b4582096b6e5e120ef40d) |
| 7 | LATE: pay a voided sale | LATE | LATE | yes | 14054 | [9f0610ac](https://testnet.tonviewer.com/transaction/9f0610ac1578b31a2785db11df60978100176470b623b0a2131cb5c332dd60d6) |
| 8 | GRAM sale PAID: 0.05 GRAM | PAID | PAID | yes | 12696 | [cdb902d8](https://testnet.tonviewer.com/transaction/cdb902d8d510379d27fe002c0e863bc266cdc0f1951bef0b9f4b5049b8f76080) |

Result: 8/8 as expected.
