# Branding

Files in this folder are mounted into the backend at runtime (`docker-compose.yml`:
`./branding:/app/public/branding`), so you can replace them without rebuilding the image.

| File | Used for |
|---|---|
| `logo.svg` or `logo.png` | Back office sidebar, login page, tracking page, e-mails (absolute URL), PDF labels (PNG preferred) |
| `logo-dark.svg` / `logo-dark.png` | optional variant for dark backgrounds |
| `favicon.png` (64×64) | Browser tab icon |

Replace the default VEGA Delivery files with your own (keep the file names). After changing files,
reload the page; the files are cached for 5 minutes. Set `BRAND_NAME` and `BRAND_COLOR` in `.env`.

Note: SVG files are served with a strict Content-Security-Policy (no scripts).
