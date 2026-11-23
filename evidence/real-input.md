# Real-input replay (mainnet, read-only)

- Date: 2026-11-23T19:45:02.371Z
- Addresses (busiest USDT receivers, top of 50-row query): 0:852443F8599F..., 0:C6AD1F60098D...
- Window: last 24 h (2026-11-22T19:44:17.000Z to 2026-11-23T19:44:17.000Z)
- Fake sale: ref `st:zz9test9`, 1 USDT, asset = mainnet USDT master, allowlist = native + that master
- Page cap: HIT 100-row limit on at least one query (window may be incomplete)
- Per address: 0:852443F8599F...: native=663 jetton=1000 state=UNMATCHED; 0:C6AD1F60098D...: native=152 jetton=1000 state=UNMATCHED

## Totals

- Payments scanned: 2815 (native 815, jetton 2000)
- Verdicts: COUNTED 0, FAKE 0, UNMATCHED 2811, IGNORED 4, LATE 0, DUPLICATE 0
- Non-allowlisted jetton masters: 4
- Comments containing http or t.me: 0
- Failed or bounced: 0
- Comments that parse as an st: ref: 0 (of which our ref: 0)

## Example spam / scam payments

| Kind | Asset master | Comment (40 chars) | Status | Tx hash |
|---|---|---|---|---|
| jetton | 0:4A31F8D7FDAFDDB0E2... | - | ok | k9147fIWVcCuC/QKuvjgt2VHAx0XdRKe2teeDEP3bfc= |
| jetton | 0:F4BDD480FCD79D47DB... | - | ok | 0AwMYXmMZdViWoEDMXGsnbq9rpB/wrdPF3lX9zVVwOw= |
| jetton | 0:F83F7D94D74B273682... | - | ok | f/AFMPrP4H2N0i0IKQySxf8lyOlRaZvfnxg8bBxy6fg= |
| jetton | 0:B298B457A75418C592... | - | ok | 3UyDerAAlEpsIfARriab3E0KW/mDqWKmuKzMrfQPWR4= |

## Verdict

PASS: no false PAID on 2815 real payments (COUNTED 0, FAKE 0, no spam/failed counted).
