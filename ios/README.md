# VEGA Delivery – iOS driver app

SwiftUI, iOS 17+, turn-by-turn navigation with [Ferrostar](https://github.com/stadiamaps/ferrostar)
(MapLibre map, Valhalla routing through the server's proxy). English and German.

Basic UI – the visual design follows later.

## Features

- Sign-in by scanning the personal QR code (format v3 contains the server URL) or typing the code
- Tour list (running, today, upcoming, finished) with offline copy
- Tour detail: map preview, stops with orders and items, **Start tour** (notifies customers,
  activates live tracking), **Finish tour**
- Car navigation to the next stop: automotive camera, voice instructions in the device language,
  wrong-way detection, arrival by geofence (50 m) or "I'm here", "Later", re-optimize from here,
  offline routes prefetched for every leg
- Stop sheet: customer, address, delivery notes, orders; call, WhatsApp, Apple Maps, notify customer
- **Outcome buttons from the back office** (freely extensible) with their required proofs:
  reason (list + text), recipient / neighbour, photo, signature, barcode scan (delivery EAN-13 or
  customer EAN-8 composite incl. umlaut decoding of the name)
- Outbox: every event is stored on the device first and sent with retry (idempotent `client_id`);
  rejected events are shown in the tour
- Live position for tracking links and the dispatcher map (every 15 s / 100 m, batched offline)
- Map style from the server (`MAP_PROVIDER=osm|mapbox`), brand colour from `BRAND_COLOR`

## Build

```bash
brew install xcodegen      # once
cd ios && xcodegen
open VegaDelivery.xcodeproj
```

Confirm **"Trust & Enable"** once for the macro package `MapLibreSwiftUI` (via Ferrostar). On the
command line add `-skipMacroValidation`:

```bash
xcodebuild -project VegaDelivery.xcodeproj -scheme VegaDelivery \
  -destination 'platform=iOS Simulator,name=iPhone 16' -skipMacroValidation test
```

## Your own distribution

- `Config/Shared.xcconfig`: `VD_BUNDLE_ID`, `VD_DISPLAY_NAME`, `VD_DEFAULT_SERVER_URL`
- `Config/Signing.local.xcconfig` (not in the repo): `DEVELOPMENT_TEAM = ABCDE12345`
- App icon: `VegaDelivery/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`
- Texts: `VegaDelivery/Resources/Localizable.xcstrings` (English source, German translation),
  permission texts in `InfoPlist.xcstrings`

## Testing against a local server

```bash
ios/scripts/local-server.sh          # default server = this Mac on the local network
cd backend && BASE_URL=http://localhost:3100 node scripts/seed-demo.mjs --fake-route
```

The seed script prints a driver code. In the simulator `http://localhost:3100` works; on a device
use the Mac's `.local` address. Without Valhalla the app falls back to "arrival by GPS".
The simulator can fake a drive: set the environment variable `VD_SIMULATE_DRIVE=1` in the scheme.
