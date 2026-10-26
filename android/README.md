# VEGA Delivery – Android driver app (basic version)

Kotlin, Jetpack Compose, minSdk 26, turn-by-turn navigation with
[Ferrostar](https://github.com/stadiamaps/ferrostar) (MapLibre map, Valhalla routing through the
server's proxy). English and German. **No Google Play services required** (location via the
platform `LocationManager`, scanning with ZXing) – suitable for F-Droid.

Basic UI – the visual design follows later. Same server API as the iOS app (`docs/APP-API.md`).

> **Status:** written without a local Android SDK and therefore **not compiled yet**. The Ferrostar
> API calls were checked against the 0.58.0 sources. Please build once in Android Studio and report
> or fix compile errors.

## Features

- Sign-in by scanning the login QR code (v3, contains the server URL), typing the code, or opening a
  `vegadelivery://login?…` link from the system camera
- Tour list (running, today, upcoming, finished) and tour detail with orders; offline copies
- **Start tour** (notifies customers, starts live tracking) and **Finish tour**
- Car navigation to the next stop (Ferrostar), arrival by geofence (50 m) or "I'm here", "Later"
- Stop sheet: customer, address, delivery notes, orders, call / WhatsApp / maps / notify customer
- **Outcome buttons from the back office** (freely extensible) with required proofs: reason,
  recipient / neighbour, photo (CameraX), signature, barcode scan (EAN-13 label or EAN-8 customer
  barcode)
- Outbox in Room, delivered by WorkManager with retry when the network is back; rejected events are
  shown in the tour
- Live position as foreground service (`location` type) every 15 s / 100 m for tracking links
- Map style from the server (`MAP_PROVIDER=osm|mapbox`), brand colour from `BRAND_COLOR`

## Build

Requirements: Android Studio (or Android SDK 36 + JDK 17/21).

1. Open the `android/` folder in Android Studio. It downloads Gradle 8.14.6 (wrapper properties are
   included; the wrapper JAR is created by Android Studio or with `gradle wrapper`).
2. Run the `app` configuration on an emulator or device.

Command line (with a local Gradle):

```bash
cd android
gradle wrapper --gradle-version 8.14.6
./gradlew testDebugUnitTest assembleDebug
```

## Your own distribution

`gradle.properties`:

- `vd.applicationId` – application id (default `org.example.vegadelivery`)
- `vd.appName` – launcher name
- `vd.defaultServerUrl` – default server (`http://10.0.2.2:3100` = the host machine from the emulator)

Plain HTTP is only allowed for `10.0.2.2`, `localhost` and `*.local` (`res/xml/network_security_config.xml`).
Texts: `res/values/strings.xml` (English) and `res/values-de/strings.xml` (German).

## Testing against a local server

```bash
cd backend && BASE_URL=http://localhost:3100 node scripts/seed-demo.mjs --fake-route
```

Sign in with the printed driver code; in the emulator the default server `http://10.0.2.2:3100`
reaches the backend on the host. Simulate a drive with the emulator's location controls (Extended
controls → Location → Routes).
