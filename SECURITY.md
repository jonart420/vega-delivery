# Security policy

Please report vulnerabilities **privately** via GitHub's "Report a vulnerability" (security
advisories) of this repository instead of opening a public issue. We aim to respond within a week.

Operational notes:
- Run with `APP_ENV=production` (default) – the backend refuses to start serving while secrets are
  weak or still contain example values.
- Put the backend behind HTTPS and set `COOKIE_SECURE=true`.
- Tracking links contain 128-bit random tokens, expire after the tour day and reveal only the
  customer's own stop; the vehicle position is only shown during the last *N* stops.
- Login codes are stored hashed; revoke lost codes in **Team** (devices are signed out).
