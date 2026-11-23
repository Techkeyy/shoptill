# UAT 2: re-pair, voice price, pay, receipt (2026-11-23, testnet)

Owner at the PC with the Even Hub simulator (glasses app) and their phone (Telegram + Tonkeeper testnet).

| Step | Result |
|---|---|
| Re-pair new glasses to an existing shop | Code sent to @ShopTillBot linked the new device to shop 1 "Barber t" with no re-onboarding (fix 87189ae). Old counter QR still worked. |
| Price set on glasses | Sale `df431vsn` armed at 12.50 USDT, 21:26:35 UTC. Two earlier 50.00 sales were voided by the owner within 3 s. |
| Customer pays from the counter QR | Customer wallet `0QA4…s05` paid 12.50 test USDT. Chain time 21:28:39 UTC. |
| Glasses | PAID 12.50 USDT (big-type screen), `evidence/screens/uat2-paid.png` |
| Detection latency | Server log: `chain->seen=2s chain->paid=2s` (block time to the server seeing it and marking it PAID). |
| Receipt | Tap on glasses → `receipt_sent=1` |

Tx (base64 hash): `o8Vnul9xEnUezboXCkFpmDUxmQ2kMHnspnylo/lbYXA=`
