# API contract (glasses -> server)

Base: `VITE_API_BASE` (default http://localhost:8787). JSON unless noted. `deviceId` is a random UUID minted once on the glasses.
Server `state` values: IDLE, WAITING, PAID, SHORT, EXTRA, DUPLICATE, FAKE, UNMATCHED, LATE, VOID. Money is a decimal string ("12.00").

| Call | Request | Response |
| --- | --- | --- |
| POST /api/device/pair | `{deviceId}` | `{paired:boolean, code?:string, shopName?:string}` (code like TILL-4821 while unpaired; glasses re-call every 3 s) |
| POST /api/till/arm | `{deviceId, amount:"12.00", asset:"USDT"\|"GRAM"}` | `{saleId}` |
| GET /api/till/status?deviceId= | | `{state, sale?:{saleId, amount, asset, receivedTotal, from?, ageSec? (seconds since the payment; since creation before payment), paidAt? (epoch s of the payment), extra?, missing?}, unmatched?:{amount, from, paymentId}}` |
| POST /api/till/void | `{deviceId, saleId}` | any 200 |
| POST /api/till/receipt | `{deviceId, saleId}` | any 200 |
| POST /api/till/attach | `{deviceId, saleId, paymentId}` | any 200 |
| GET /api/today?deviceId= | | `{count, total, asset}` |
| POST /api/stt?deviceId= | raw body, `content-type: audio/wav` (PCM s16le 16 kHz mono, 6 s max) | `{text, amount: "12.00"\|null}` |

Glasses behavior: polls status every 2 s only while WAITING/SHORT. Any non-2xx or network error shows "Offline - retrying". PAID is shown only when the server returns state PAID/EXTRA. CORS must allow the simulator/WebView origin. `status` should return IDLE (or VOID) when no sale is open.
