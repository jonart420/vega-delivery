# Documentation website

A static, single-page documentation site (English) with screenshots of the back office,
the iOS driver app, the tracking page and the printed PDFs.

Preview locally:

```bash
python3 -m http.server 8765 --directory website
```

Published with GitHub Pages by `.github/workflows/pages.yml` on every push to `main` that changes
`website/` (repository Settings → Pages → Source: GitHub Actions).

Screenshots were taken from a demo installation (`backend/scripts/seed-demo.mjs`) with fictional data.
