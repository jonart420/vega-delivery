# Driver app API

Shared contract of the iOS and Android apps. Base URL = the server URL from the login QR code.
All requests except login use `Authorization: Bearer <device token>`. JSON, snake_case, UTF-8.
Errors: `{ "error": "<localized message>", "code": "<machine code>" }`.

## Login QR code (format v3)

```
vegadelivery://login?v=3&s=<server base URL, URL-encoded>&c=<20 characters Crockford Base32>
```

The app reads `s` (server) and sends the whole payload or just `c` to the login endpoint. Codes
can also be typed (`ABCD-EFGH-JKMN-PQRS-TVWX`; dashes, spaces, I/L→1 and O→0 are tolerated).

## Endpoints

| Method & path | Purpose |
|---|---|
| `POST /api/app/login` `{code, device_name?, platform?: "ios"\|"android"}` | → `{token, user}` |
| `POST /api/app/logout` | revokes this device |
| `GET /api/app/me` | current user |
| `GET /api/app/config` | branding (`brand.name/color/logo_url`), `map {provider, style_url, attribution}`, `notify_lead_stops`, `outcomes[]` with `reasons[]` and required proofs |
| `GET /api/app/tours` | the driver's tours (released/running from yesterday on, finished of the last 3 days) |
| `GET /api/app/tours/:id` | offline package: `tour` (start, end, mode, `route.geometry` `[lon,lat][]`, legs, `computed_at`) and `stops[]` in driving order with customer, address, coordinates, delivery notes, time window, `tracking_url`, `orders[]` with `delivery_ean13` and `items[]` |
| `POST /api/app/tours/:id/start` | starts the tour (sends day-start / approaching notifications); idempotent |
| `POST /api/app/tours/:id/position` `{points:[{t, lat, lon, acc?, speed?, heading?}]}` | live position, every ~15 s / 100 m while running; batch when offline (max. 2000) |
| `POST /api/app/tours/:id/events` | delivery event (see below) |
| `POST /api/app/tours/:id/notify` `{stop_id}` | manual notification with tracking link |
| `POST /api/app/tours/:id/finish` | finishes the tour; open stops count as skipped |
| `POST /api/app/valhalla/route` | Valhalla `/route` proxy for Ferrostar (`costing`: `auto`, `bicycle`, `pedestrian`; max. 25 locations); send the vehicle `heading` with the first location |

## Delivery events

JSON, or `multipart/form-data` with a `meta` field (same JSON) plus optional image files `photo`
and `signature` (JPEG/PNG/HEIC, max. 15 MB each).

```json
{
  "client_id": "uuid generated on the device",
  "stop_id": "…",
  "type": "outcome",            // outcome | arrived | note
  "outcome_code": "refused",
  "reason_id": "…",             // from config.outcomes[].reasons
  "reason_text": "free text",
  "recipient_name": "Frau Schröder",
  "neighbor_info": "Nr. 12, 2. OG",
  "scanned_codes": ["52451652|(91)Herbert_M%C3%BCller"],
  "note": "…",
  "lat": 53.55, "lon": 9.99,
  "occurred_at": "2026-10-27T09:41:00+01:00"
}
```

- Required proofs follow the outcome (`requires_reason`, `requires_photo`, `requires_signature`,
  `requires_recipient`, `requires_scan`); violations return 422 with `code` `event_*_required`.
- `requires_scan` accepts the order EAN-13 and/or the customer EAN-8 (setting `scan_accept`).
  Composite scans may be sent raw; only the digits before `|` are compared.
- `client_id` makes the request idempotent: resending returns `200 {duplicate: true}`. Apps keep
  events in an outbox and retry until the server answered 2xx or 4xx.
- Response: `{event_id, duplicate, stop_status, outcome_kind}`.

## Navigation defaults for cars

Arrival radius ~50 m, step advance ~40 m, off-route threshold ~50 m, automotive camera
(zoom 15–16), `activityType` automotive navigation, instructions in the user's language.
