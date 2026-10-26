# Documentation website

A static, single-page documentation site (English) with screenshots of the back office,
the iOS driver app, the tracking page and the printed PDFs.

Preview locally:

```bash
python3 -m http.server 8765 --directory website
```

Publish with GitHub Pages: Settings → Pages → "Deploy from a branch", branch `main`, folder `/website`
is not offered by GitHub, so either move the folder to `docs/` or use a Pages workflow that uploads
`website/` as the artifact.

Screenshots were taken from a demo installation (`backend/scripts/seed-demo.mjs`) with fictional data.
