# Real-input replay (mainnet, read-only)

- Date: 2026-11-23T19:24:36.184Z
- Addresses (busiest USDT receivers, top of 50-row query): 0:852443F8599F..., 0:C6AD1F60098D...
- Window: last 24 h (2026-11-22T19:24:31.000Z to 2026-11-23T19:24:31.000Z)
- Fake sale: ref `st:zz9test9`, 1 USDT, asset = mainnet USDT master, allowlist = native + that master
- Page cap: HIT 100-row limit on at least one query (window may be incomplete)
- Per address: 0:852443F8599F...: native=63 jetton=100 state=UNMATCHED; 0:C6AD1F60098D...: native=17 jetton=100 state=UNMATCHED

## Totals

- Payments scanned: 280 (native 80, jetton 200)
- Verdicts: COUNTED 0, FAKE 0, UNMATCHED 279, IGNORED 1, LATE 0, DUPLICATE 0
- Non-allowlisted jetton masters: 1
- Comments containing http or t.me: 0
- Failed or bounced: 0
- Comments that parse as an st: ref: 0 (of which our ref: 0)

## Example spam / scam payments

| Kind | Asset master | Comment (40 chars) | Status | Tx hash |
|---|---|---|---|---|
| jetton | 0:B298B457A75418C592... | - | ok | 3UyDerAAlEpsIfARriab3E0KW/mDqWKmuKzMrfQPWR4= |

## Verdict

PASS: no false PAID on 280 real payments (COUNTED 0, FAKE 0, no spam/failed counted).
