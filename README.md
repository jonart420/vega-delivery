# VEGA Delivery

Open-source delivery planning for small and medium delivery teams: keep your **address book**,
**products** and **orders**, plan them into **tours**, get a **car-optimized route with
turn-by-turn navigation** in the driver app, log every delivery (delivered, refused with reason,
aborted, …) and let customers follow their delivery via a **live tracking link** sent by
**e-mail and WhatsApp**.

> Deutsche Fassung: [README.de.md](README.de.md)

| Part | Technology |
|---|---|
| Back office + API | Next.js 16, PostgreSQL 17, MapLibre (`backend/`) |
| Routing & navigation | Valhalla (self-hosted, any OSM region up to the whole planet) |
| Driver apps | iOS (SwiftUI + Ferrostar, `ios/`) and Android basic version (Kotlin + Compose + Ferrostar, `android/`, not yet compiled) |
| Maps | free OpenStreetMap vector map (OpenFreeMap) **or** Mapbox – selectable via `.env` |
| Notifications | SMTP e-mail, WhatsApp via Meta Cloud API or Twilio |

License: **AGPL-3.0-only** – if you offer a modified version as a service, you must publish your changes.

## Features

- **Address book** – customers with geocoded address (pin correction on the map), contact data,
  notification consent, delivery notes, time windows, CSV import/export.
- **Products** – category tree and products (SKU, unit, price, VAT, EAN-13).
- **Orders** – items from products or free text, delivery date and time window, statuses,
  rescheduling, printable delivery labels.
- **Tours** – plan open orders of a day (orders of one customer share one stop), optimize the
  order for cars (exact up to 13 stops, 2-opt/Or-opt above, soft time windows, pinned positions),
  manual reordering, assign driver, release, loading list and labels as PDF, live view while driving.
- **Delivery outcomes & reasons – freely extensible** – buttons in the app (delivered, left with
  neighbour, safe place, nobody home, refused, aborted, partially delivered, your own …) with
  required proofs per outcome: reason, photo, signature, recipient name, barcode scan.
  Every action is logged per customer and tour.
- **Barcodes** – EAN-13 delivery code per order (constant per customer *or* new per delivery)
  and the **customer indicator as EAN-8 composite (ISO/IEC 24723)**: customer number in the linear
  part, name in the 2D part (umlauts encoded GS1-compliantly). A one-page **customer barcode sheet**
  stays at the customer – scanning it is the proof of delivery, no new label per order needed.
- **Tracking link** – public page per stop, live vehicle position only once the customer is among
  the next *N* (default 3) stops, then the delivery result.
- **Automatic and manual notifications** – at tour start every customer gets a "delivery today"
  message, the next 3 customers get "we are almost there" with the live link (and tracking is
  activated); the window moves forward with every completed stop. Manual sending from back office
  and app. Templates per language, editable.
- **Security gate** – in production the backend stays locked while `.env` still contains example
  values or weak passwords.
- **i18n** – English and German (UI, messages, tracking page, apps), full Unicode/umlaut support.
- **Branding** – your logo in `branding/`, name and colour via `.env`.

## Quick start (Docker)

Requirements: Docker with Compose, ~5 GB disk for a city/region (a whole country needs more, see
[docs/VALHALLA.md](docs/VALHALLA.md)).

```bash
git clone <your fork> vega-delivery && cd vega-delivery
./scripts/generate-env.sh https://delivery.example.com   # .env with random secrets
# edit .env: VALHALLA_TILE_URLS (your region), SMTP_*, WHATSAPP_*, MAP_PROVIDER …
docker compose up -d
docker compose logs -f valhalla   # first start downloads OSM data and builds routing tiles
```

The back office runs on `http://127.0.0.1:3100` (put a reverse proxy with HTTPS in front, see
[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)). Sign in with `admin` and the password printed by
`generate-env.sh`.

First steps:
1. **Settings → General**: company name and depot (start/end of tours).
2. **Team**: add drivers – each gets a personal QR login code for the app.
3. **Address book** and **Products**, then **Orders**.
4. **Tours**: create a tour for a date, add orders, *Optimize route*, assign driver, *Release*.
5. The driver signs in to the app by scanning the QR code and starts the tour.

## Configuration

All options are documented in [`.env.example`](.env.example). Highlights:

| Variable | Purpose |
|---|---|
| `APP_ENV` | `production` (default; security gate active) or `development` |
| `PUBLIC_BASE_URL` | public URL – used in tracking links, e-mails and app QR codes |
| `VALHALLA_TILE_URLS` | OSM extracts for routing (city … planet) |
| `MAP_PROVIDER` | `osm` (free, default) or `mapbox` (+ `MAPBOX_ACCESS_TOKEN`, `MAPBOX_STYLE`) |
| `SMTP_*` | e-mail delivery |
| `WHATSAPP_PROVIDER` | `none`, `log`, `meta` or `twilio` (see [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md)) |
| `DEFAULT_LOCALE` | `en` or `de` |
| `BRAND_NAME`, `BRAND_COLOR` | branding (logo files in `branding/`) |

## Documentation

- [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) – reverse proxy, backups, updates
- [docs/VALHALLA.md](docs/VALHALLA.md) – routing regions, resource needs, updates
- [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) – e-mail, WhatsApp (Meta/Twilio), notification flow
- [docs/BARCODES.md](docs/BARCODES.md) – EAN-13, EAN-8 composite, customer barcode sheet, scanning
- [docs/APP-API.md](docs/APP-API.md) – API used by the driver apps, QR login format
- [ios/README.md](ios/README.md), [android/README.md](android/README.md) – building the apps

## Development

```bash
cd backend
npm install
cp ../.env.example ../.env   # set APP_ENV=development, DATABASE_URL, VALHALLA_URL …
set -a; . ../.env; set +a
npm run dev                  # http://localhost:3000
npm test                     # unit tests (barcodes, optimizer, security gate, maps)
npm run lint && npm run build
```

End-to-end test against a running backend with an **empty** database
(`APP_ENV=development`, `WHATSAPP_PROVIDER=log`): `E2E_DATABASE_URL=… node tests/e2e/smoke.mjs`.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
