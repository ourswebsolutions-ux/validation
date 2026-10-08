# WhatsApp Number Checker

A single-page web app that checks whether phone numbers are registered on WhatsApp. You can check one number, paste a list, or import a CSV. Results update live, you can filter them, and you can export the WhatsApp-registered numbers as CSV.

- No accounts, logins or user database. Temporary state lives in the browser's LocalStorage and expires automatically.
- Checks run on the server through a linked WhatsApp device using [Baileys](https://github.com/WhiskeySockets/Baileys). Results come from WhatsApp, not from heuristics.
- Lookups go through a conservative, rate-limited server queue.

> **Intended use:** verifying contact numbers you are permitted to process. The app only returns whether a number is registered. It does not send messages, read profiles or collect any other data, and it contains nothing that tries to get around WhatsApp's limits. Automated lookups may still go against WhatsApp's Terms of Service and can get the linked number restricted. Use a number you can afford to lose and keep the rate conservative.

---

## 1. Requirements

- **Node.js 20.9 or newer** (Node 22 LTS recommended). Baileys refuses to install on older versions.
- npm 10+
- A phone with WhatsApp to link as the checking device.
- Outbound internet access from the server to WhatsApp (WebSocket over 443).

## 2. Node.js version

```bash
node -v   # must print v20.9.0 or newer
```

## 3. Installation

```bash
npm install
cp .env.example .env.local   # then adjust values (see section 11)
```

## 4. Development

```bash
npm run dev        # http://localhost:3000
npm run typecheck  # TypeScript
npm run lint       # ESLint
npm test           # unit tests (normalization, CSV, server queue)
```

The WhatsApp session is a process-wide singleton and survives hot reloads.

## 5. Production build

```bash
npm run build
```

## 6. Starting the server

```bash
npm start              # port 3000
npm start -- -p 8080   # custom port
```

Run it as **one long-lived Node.js process** (systemd, PM2, Docker, a VM). The WhatsApp socket and the job queue live in that process's memory, so:

- Do **not** deploy it to serverless or edge platforms (e.g. Vercel functions). The socket would be torn down between requests.
- Do **not** run several instances or cluster mode against the same `WA_AUTH_DIR`. Each instance would open its own WhatsApp session.

The WhatsApp connection starts automatically when the server boots (`instrumentation.ts`).

## 7. WhatsApp QR connection

1. Open the site. The status pill at the top shows the connection state: **Connected**, **Connecting**, **QR Scan Required**, **Reconnecting** or **Disconnected**.
2. If a QR scan is needed, the connection panel opens by itself (click the pill to toggle it).
3. On your phone, open **WhatsApp → Settings → Linked devices → Link a device** and scan the code. It refreshes about every 20 seconds.
4. The pill turns 🟢 **Connected**. The session is saved in `WA_AUTH_DIR` and reused after restarts.

Session lifecycle:

| Event | What the server does |
|---|---|
| Network drop / server-side close | Reconnects automatically with exponential backoff (up to 60 s) |
| QR codes expire unscanned | Stops and waits; click **Generate QR** |
| Device unlinked from the phone (logged out) | Deletes the local session; click **Generate QR** to link again |
| Session opened elsewhere (replaced) | Stops and waits; click **Reconnect** |
| **Unlink device** button | Logs out of WhatsApp and deletes the local session |

Bulk jobs that are running when the connection drops pause in a *waiting for connection* state. They continue on their own once WhatsApp is back, and no numbers are marked as errors because of the drop.

## 8. How single checking works

1. Type the number **with its country code** in any format (`+923245237429`, `+92 324 5237429`, `+1 (415) 555-2671`, `0092 324 5237429`…). There is no country selector.
2. The country is detected from the international calling code and the number is normalized to E.164 (`+923245237429`). Both are shown as you type, e.g. *Detected: 🇵🇰 Pakistan (+92)*.
3. **Check Number** sends it to `POST /api/check-number`. The server validates it again and asks WhatsApp through the shared rate gate.
4. Result: ✅ **WhatsApp Available** / ❌ **WhatsApp Not Available**, plus the international format. If the number was already checked in this browser session, the cached result is shown and WhatsApp is not asked again.

## 9. How bulk checking works

1. **Multiple Numbers**: paste numbers separated by new lines, commas, semicolons or spaces. **Import CSV**: drop or choose a `.csv` file.
2. **Preview** detects the country of **each number independently** from its calling code, so one list can mix any countries. It then validates, normalizes to E.164 and removes duplicates by the E.164 value: `+92 324 5237429`, `+923245237429` and `+92-324-5237429` count as one number and are checked once. Numbers without a country code (e.g. `03245237429`) are marked *Invalid — Country code required* rather than guessed. You see Total / Valid / Invalid / Duplicates Removed, and the table shows # / Original Number / Country / Code / Normalized Number / WhatsApp Status / Checked At.
3. **Start Checking**:
   - Numbers already checked in this browser session are filled in from the local cache.
   - The rest are sent to the server in chunks of at most `MAX_NUMBERS_PER_REQUEST` (default 500). Each chunk becomes a server-side job (`POST /api/check-numbers`).
   - The server queue checks `CHECK_BATCH_SIZE` numbers per WhatsApp query (default 5), with at least `CHECK_INTERVAL_MS` between queries (default 3 s). All jobs and single checks share this one gate.
   - The browser polls `GET /api/check-numbers/:jobId?cursor=N` and only receives results it hasn't seen yet. It does **not** send one request per number.
4. The progress panel shows the percentage, counts, an estimated time remaining, and **Pause / Resume / Stop**. Stop asks for confirmation. Unchecked numbers stay *Pending* and **Continue checking** picks them up later.
5. A failed batch is retried twice with backoff, then marked *Error*. The queue carries on. **Retry errors** re-queues only the failed numbers.
6. **Resumable**: progress is saved in LocalStorage. After a page refresh the run continues. If the server restarted in between, the remaining numbers are submitted again.

At the default rate, 1,000 numbers take about 10 minutes (1000 ÷ 5 × 3 s).

Results can be filtered (All / WhatsApp Available / Not Available / Invalid / Errors) and searched. They are shown 50 per page, as a table on desktop and as cards on mobile, so large lists don't freeze the browser.

## 10. CSV format

- Delimiter is auto-detected (`,` `;` tab `|`). A UTF-8 BOM is handled.
- **Single column**: used as the number column, with or without a header.
- **Several columns**: the number column is detected from these header names:
  `phone`, `phone_number`, `mobile`, `mobile_number`, `number`, `whatsapp`, `whatsapp_number`, `contact` (plus variants like `cell`, `tel`, `msisdn`).
  If no header matches, the column with the most phone-like values is suggested. You can change it with the **Phone number column** selector.
- The CSV row number of each number is kept and shown in the table.
- No country needs to be chosen. Every row's country is detected from its own `+` country code (`00` international prefixes also work), so mixed-country files are fine. Rows without a country code are marked invalid.
- Limits: `NEXT_PUBLIC_MAX_CSV_MB` (default 5 MB) and `NEXT_PUBLIC_MAX_NUMBERS` rows (default 20,000).

Example:

```csv
number
+923245237429
+447911123456
+14155552671
+971501234567
```

**Export** (generated in the browser):

| Button | File | Content |
|---|---|---|
| Export Valid Numbers | `whatsapp-valid-numbers.csv` | `number,status` rows where status = `available` |
| Export All Results | `whatsapp-check-results.csv` | `number,status` for every row (`available`, `not_available`, `invalid`, `error`, `pending`) |

Cells that could be read as spreadsheet formulas are escaped. E.164 numbers are left unchanged.

## 11. Environment variables

See [`.env.example`](.env.example). Server variables are never exposed to the browser. Only `NEXT_PUBLIC_*` values reach the client, and they contain no secrets.

| Variable | Default | Purpose |
|---|---|---|
| `WA_AUTH_DIR` | `./.wa-session` | Server-side Baileys session folder. Must be outside `public/`; startup refuses otherwise. |
| `LOG_LEVEL` | `warn` | Server log level |
| `CHECK_BATCH_SIZE` | `5` | Numbers per WhatsApp lookup (1–20) |
| `CHECK_INTERVAL_MS` | `3000` | Minimum gap between lookups (floor 1000) |
| `CHECK_TIMEOUT_MS` | `20000` | Per-lookup timeout |
| `CHECK_CACHE_TTL_MS` | `3600000` | Server-side reuse of recent answers (0 = off) |
| `MAX_NUMBERS_PER_REQUEST` | `500` | Max numbers per bulk job request |
| `MAX_JOBS_PER_CLIENT` / `MAX_JOBS_TOTAL` | `2` / `20` | Concurrent job limits |
| `RATE_LIMIT_SINGLE_PER_MIN` | `20` | Single checks per client per minute |
| `RATE_LIMIT_JOBS_PER_MIN` | `10` | Job creations per client per minute |
| `RATE_LIMIT_READ_PER_MIN` | `240` | Status/progress polls per client per minute |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for client identity (only behind your own reverse proxy) |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | empty | When both are set, the whole site and API need HTTP Basic auth |
| `NEXT_PUBLIC_MAX_CSV_MB` | `5` | Max CSV upload size |
| `NEXT_PUBLIC_MAX_NUMBERS` | `20000` | Max numbers per list |
| `NEXT_PUBLIC_SESSION_TTL_HOURS` | `24` | When browser data is wiped automatically |

`NEXT_PUBLIC_*` values are baked in at build time, so rebuild after changing them.

## 12. Security considerations

- **WhatsApp credentials stay on the server** in `WA_AUTH_DIR` (created with `0700` where the filesystem supports it). The browser only ever receives the connection state, a masked account number (`+92•••••7429`) and the QR image while linking is required. No session data, file paths or stack traces are returned by the API.
- **Never commit the session folder.** `.wa-session/` is in `.gitignore`. Anyone with these files can act as the linked device.
- **Protect public deployments.** The site has no user accounts, so anyone who can open it can use your linked WhatsApp session and see the QR code. On any internet-facing deployment, set `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`, or put the app behind a VPN / IP allowlist / SSO proxy, and serve it over HTTPS.
- **API hardening:**
  - Every endpoint rejects cross-site browser requests (`Sec-Fetch-Site` / `Origin` checks).
  - Input is validated with zod, bodies are capped at 64 KB, and only JSON is accepted.
  - Numbers are re-validated on the server.
  - Bulk jobs are scoped to an anonymous, httpOnly, `SameSite=Strict` browser cookie (`wac_sid`). It isn't a login and holds no personal data. Other browsers get a 404 for your job.
  - Jobs that nobody polls for 5 minutes are stopped automatically.
- **Browser data:** LocalStorage holds only numbers, results, UI state and settings. Everything expires after `NEXT_PUBLIC_SESSION_TTL_HOURS`, and **Clear Session Data** wipes it immediately.
- **Response headers:** `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, and `Cache-Control: no-store` on the API.

## 13. Rate limiting

There are two layers:

1. **WhatsApp rate gate** (protects the linked number): every lookup in the process, single or bulk, goes through one serialized gate with a minimum interval of `CHECK_INTERVAL_MS`. Batches are small (`CHECK_BATCH_SIZE`). Results are cached (`CHECK_CACHE_TTL_MS` on the server, plus the browser session cache), so repeated numbers don't cause new lookups. The config enforces floors so the rate can't be turned aggressive by mistake.
2. **HTTP rate limits** (protect the API): fixed one-minute windows per client for single checks, job creation and polling. Over the limit you get `429` with a `Retry-After` header, and the UI waits and retries automatically.

Clients are identified by IP only when `TRUST_PROXY=true`. Otherwise the anonymous cookie is used, and requests without a cookie share one strict bucket. The limiter is in memory and per process.

## 14. Troubleshooting

| Symptom | Fix |
|---|---|
| `npm install` fails with a Node version error | Upgrade to Node 20.9+ |
| Pill stays **Connecting** / **Reconnecting** | Check that the server can reach `web.whatsapp.com` (proxy/firewall). Set `LOG_LEVEL=debug` and watch the server logs. |
| QR never appears / "QR code expired" | Click **Generate QR** in the connection panel |
| Was connected, now **Disconnected** with "logged out" | The device was removed from the phone. Click **Generate QR** and scan again. |
| "Session was opened elsewhere" | Another process uses the same `WA_AUTH_DIR`. Run only one instance, then click **Reconnect**. |
| Bulk check shows *Waiting for WhatsApp connection* | Reconnect WhatsApp. The job resumes on its own. |
| `429 Too many requests` / "checker is busy" | Rate or job limits reached. The UI retries automatically. Raise the limits in `.env.local` only if you have to. |
| Many *Error* results | Network trouble or WhatsApp throttling. Wait, then use **Retry errors**. Consider a larger `CHECK_INTERVAL_MS`. |
| Numbers marked *Invalid* with "Country code required" | The country is never guessed. Add the international code, e.g. `03245237429` → `+923245237429` |
| A +44 number shows *Guernsey (UK)*, *Jersey (UK)* or *Isle of Man (UK)* | That's correct. These Crown Dependencies share the UK's +44 code and have their own number ranges (e.g. +44 7911 1… is Guernsey). |
| Want to start completely fresh | Click **Unlink device**, or stop the server and delete the `WA_AUTH_DIR` folder |
| Results lost after refresh with a huge list | The browser storage quota was exceeded (a toast warns you). Split the list or export results before refreshing. |

---

## Project structure

```
app/
  page.tsx                     single page (renders the client app)
  api/whatsapp/{status,qr,reconnect,logout}/route.ts
  api/check-number/route.ts    single check
  api/check-numbers/route.ts   create bulk job
  api/check-numbers/[jobId]/route.ts   poll / pause / resume / stop
components/                    UI (NumberInput, BulkInput, CsvUploader, ResultsTable,
                               ProgressPanel, ConnectionStatus, StatsCards, ExportButtons, …)
hooks/                         useChecker (state, queue client, persistence), useConnection
lib/                           shared, browser-safe: phone-number, csv, storage, validation, types
server/                        server-only (guarded by the `server-only` package)
  whatsapp/session.ts          Baileys socket lifecycle + QR
  whatsapp/checker.ts          NumberCheckEngine interface + Baileys implementation
  whatsapp/queue.ts            job queue, rate gate, result cache
  http/                        API helpers, origin checks, rate limiting
proxy.ts                       optional Basic auth + anonymous browser id cookie
instrumentation.ts             starts the WhatsApp session at boot
tests/                         unit tests
```

**Replacing the checking engine:** implement `NumberCheckEngine` (`isReady()` and `check(numbers) → Map<number, boolean>`) in `server/whatsapp/checker.ts` and pass it to `CheckQueue` in `getCheckQueue()`. Nothing else needs to change.

**How the lookup works:** the Baileys engine sends one USync *contact* query per batch through `sock.executeUSyncQuery`. This is the same protocol Baileys' `onWhatsApp()` uses, but the parser also reads back the phone number WhatsApp echoes for each result. That way every answer is matched to the number that was asked, even when WhatsApp returns a rewritten JID.
# validation
# validation
