# P0 spike evidence

Run: 2026-11-23T17:27:57.661Z (TON Center v3 testnet, API key: no)
Merchant: 0QDAX4h7qA6UcvNHBYtQ7m3OGDconur0DytMFD-JA0GXsGmu
Customer: 0QA4Bsge9Ja6LiIBPkFZBz0ZGS49AYWMmPK1WSPLc1fxAs05
Allowlisted USDT master: kQDT4p-DQndltAR_kEYzCoXO6IDlWXgmXYnolq21zxaYjEXT
Fake USDT master: kQBsPFfpUnjPLYD4C_TmH19xyIejkTvYhIitFgxkMk9ymW2b

latency = send accepted by toncenter v2 -> matching payment returned by v3 via our client (includes 1.1s request throttle)

| # | case | ref | tx hash | latency ms | classified | as expected |
|---|---|---|---|---|---|---|
| 1 | native GRAM | hgv1xp | JGiNYw6WVwfslf+IdmPVbGbjlcg/+MHKNfXvjF989VE= | 1882 | PAID | true |
| 2 | native GRAM | zmauxk | vLhCACnuEMvrEicitAOs/0CR/oaEft++quMl8d11hkA= | 2393 | PAID | true |
| 3 | native GRAM | y6kbu9 | p3dzDtmLe/Qe2gC9tUoX4LNPNfaMuXtWCSbBKbBPrro= | 1298 | PAID | true |
| 4 | native GRAM | utad1l | xElipNaQiss/sDqQ8VdTeqboeJf9CCmBo11GFaiC71M= | 3558 | PAID | true |
| 5 | native GRAM | he4bvs | j/kyZh+Z1AXknUQH+fmyePQaNK/x5AP6fJ+DOYMD4hw= | 2492 | PAID | true |
| 6 | allowlisted USDT | 7o7zh8 | m+dvT+WAE1eDrOLZ4kgwMu7vHr8CCfyRs898BRH6wTw= | 1313 | PAID | true |
| 7 | allowlisted USDT | qjnop8 | RCtQF7kWojXUS5mZDaiTLRahOaXWm75f06rEUGMptxI= | 3563 | PAID | true |
| 8 | allowlisted USDT | axyhey | DZi8DChvCdHvUTkMBE6ESs5jbp5A5mLO8UgG4I4Z+Lk= | 1669 | PAID | true |
| 9 | allowlisted USDT | lptfhl | AETlW8+FxgWVfJpOxlrrH+2Z/oeroV8yl0JkHYUisvc= | 2710 | PAID | true |
| 10 | allowlisted USDT | a3udcp | AbF+s0Ze/Qxi9ynEdnmMpRAqFdlDMQUdJPfpJxiOeu0= | 2459 | PAID | true |
| 11 | FAKE USDT | m8vx4q | gFVA7w7P8KnCz9ZESPQ9FMyofvO3LYZob4FhuUUePtM= | 3571 | FAKE | true |

Correct: 11/11
Max latency: 3571 ms
