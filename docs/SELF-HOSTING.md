# Self-hosting

## Reverse proxy (HTTPS)

The backend listens on `127.0.0.1:3100` by default. Put any reverse proxy with TLS in front and
set `PUBLIC_BASE_URL=https://your-domain` and `COOKIE_SECURE=true`.

Caddy example:

```
delivery.example.com {
  reverse_proxy 127.0.0.1:3100
}
```

Pass `X-Forwarded-For` (Caddy/nginx/Traefik do by default) – it is used for the login rate limit.

## Security gate

With `APP_ENV=production` (default) the backend checks `.env` at every start. Example values
(`change-me…`), empty secrets, passwords shorter than 16 characters and secrets shorter than 32
bytes lock the system: every page shows what to fix, the API answers 503, no admin is created and
no message is sent. Fix `.env` and run `docker compose up -d`. `scripts/generate-env.sh` creates a
`.env` with strong random values.

## Backups

```bash
scripts/db-backup.sh                                   # → backups/vega-YYYYMMDD-HHMM.sql.gz
scripts/db-restore.sh backups/vega-20261026-1800.sql.gz
```

Also back up `.env` (especially `LOGIN_CODE_SECRET` – changing it invalidates all driver login
codes), `branding/` and the uploads volume (proof-of-delivery photos and signatures):
`docker run --rm -v vega-delivery_uploads:/u -v "$PWD/backups:/b" alpine tar czf /b/uploads.tgz -C /u .`

## Updates

```bash
git pull
docker compose build backend
docker compose up -d
```

Database migrations run automatically on start. Map data: see [VALHALLA.md](VALHALLA.md).

## Linux paths instead of Docker volumes

Set `PGDATA_MOUNT`, `VALHALLA_MOUNT`, `UPLOADS_MOUNT` to absolute paths (the uploads folder must be
writable for UID 1000).

## Geocoding

Address search uses the public Photon instance of komoot by default (fair use, no key). For many
addresses run your own Photon and set `GEOCODER_URL`; `GEOCODER_BBOX` limits results to a region.
