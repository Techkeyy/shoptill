# API contract (glasses -> server)

Base: `VITE_API_BASE` (default http://localhost:8787). JSON unless noted. `deviceId` is a random UUID minted once on the glasses. It is an identifier, not a credential: the first `/api/device/pair` for a new device returns a random `deviceSecret` (once), which the glasses keep in bridge localStorage and send as the `x-device-secret` header on every call (pair included, once they have it). Calls with a missing or wrong secret get 403, which the glasses treat as "not paired".
Server `state` values: IDLE, WAITING, PAID, SHORT, EXTRA, DUPLICATE, FAKE, UNMATCHED, LATE, VOID. Money is a decimal string ("12.00").

| Call | Request | Response |
| --- | --- | --- |
| POST /api/device/pair | `{deviceId}` (+ `x-device-secret` once known) | `{paired:boolean, code?:string, shopName?:string, deviceSecret?:string}` (code like TILL-482193, 6 digits, valid 30 min, refreshed on the next call; `deviceSecret` only on the call that mints/re-issues it; a paired device with a wrong/missing secret gets 403; 429 when over the rate limit) |
| POST /api/till/arm | `{deviceId, amount:"12.00", asset:"USDT"\|"GRAM"}` | `{saleId}` |
| GET /api/till/status?deviceId= | | `{state, sale?:{saleId, amount, asset, receivedTotal, from?, ageSec? (seconds since the payment; since creation before payment), paidAt? (epoch s of the payment), extra?, missing?}, unmatched?:{amount, from, paymentId}}` |
| POST /api/till/void | `{deviceId, saleId}` | any 200 |
| POST /api/till/receipt | `{deviceId, saleId}` | any 200 |
| POST /api/till/attach | `{deviceId, saleId, paymentId}` | any 200 |
| GET /api/today?deviceId= | | `{count, total, asset}` |
| POST /api/stt?deviceId= | raw body, `content-type: audio/wav` (PCM s16le 16 kHz mono, 6 s max) | `{text, amount: "12.00"\|null}` |

Glasses behavior: polls status every 2 s only while WAITING/SHORT. Any non-2xx or network error shows "Offline - retrying". PAID is shown only when the server returns state PAID/EXTRA. CORS must allow the simulator/WebView origin. `status` should return IDLE (or VOID) when no sale is open.
