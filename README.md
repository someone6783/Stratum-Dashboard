<div align="center">

# ▰ STRATUM

**Fast dashboards, composed with portable JSON.**

[Quick start](#quick-start) · [Dashboard JSON](#dashboard-json) · [API](#api) · [Security](#security)

</div>

Stratum is a compact dashboard workspace with two faces: a visual editor for changing dashboard definitions and a server-rendered published view for opening them quickly. The browser handles viewing and interaction; the Docker backend validates and owns every saved dashboard.

## What is included

- JSON-defined layouts with metrics, charts, status lists, links, trusted HTML, and sandboxed external embeds
- A separate search homepage with configurable provider and shortcuts
- A live weather workspace with location search, custom condition icons, and a seven-day outlook
- Lazy-loaded JSON editor with browser and server validation
- Revisioned, atomic file persistence on a Docker volume
- A lightweight `/published/:id` HTML response that ships no React or editor JavaScript
- Responsive dark interface, custom accent colors, and an included starter dashboard

## Quick start

### Docker

```bash
docker compose up --build
```

Open `http://localhost:8787`. Dashboard data is stored in the named `stratum-data` volume.

### Local development

```bash
npm install
npm run dev
```

The workspace opens at `http://localhost:5173`; Vite forwards API and published-view requests to the backend on port `8787`.

## Dashboard JSON

Every document is validated against the shared Zod contract in [`shared/dashboard.ts`](shared/dashboard.ts). A small definition looks like this:

```json
{
  "schemaVersion": 1,
  "id": "team-home",
  "title": "Team home",
  "mode": "dashboard",
  "theme": { "accent": "#b7f34a", "density": "compact" },
  "widgets": [
    {
      "id": "deploys",
      "type": "metric",
      "title": "Deploys",
      "value": "38",
      "detail": "+12% this month",
      "accent": "lime",
      "grid": { "colSpan": 4 }
    }
  ],
  "revision": 0
}
```

A complete importable definition is available in [`examples/overview.json`](examples/overview.json).

### Widget types

| Type | Purpose | Main fields |
| --- | --- | --- |
| `metric` | A headline number and trend | `value`, `detail`, `trend` |
| `chart` | A compact line chart | `labels`, `values` |
| `status` | Service or process health | `items[]` |
| `links` | Bookmarks and shortcuts | `items[]` |
| `html` | Sanitized internal markup | `html` |
| `embed` | Sandboxed external page | `url`, `height` |

Use `grid.colSpan` from 1–12 to size a widget. On small screens, cards stack automatically. Change `theme.accent` to any six-digit hex color.

## Fast published view

Open `/published/<dashboard-id>` for the read-only version. The backend converts the saved definition directly into an HTML response with inline critical CSS. It avoids the editor bundle and React runtime, so cached dashboards can paint as soon as the HTML arrives. Interactive third-party embeds still load at the speed of their source.

The default views are:

- `http://localhost:8787/published/overview`
- `http://localhost:8787/published/search-home`
- `http://localhost:8787/published/weather`

## Weather dashboard

Open `#weather` in the workspace or select **Weather** in the sidebar. The bundled definition uses Perth and can be changed through its JSON:

```json
{
  "mode": "weather",
  "weather": {
    "location": "Perth, Western Australia",
    "latitude": -31.9523,
    "longitude": 115.8613,
    "temperatureUnit": "celsius"
  }
}
```

The browser retrieves current, hourly, and seven-day forecast data directly from [Open-Meteo](https://open-meteo.com/en/docs). Location search uses its [Geocoding API](https://open-meteo.com/en/docs/geocoding-api). Neither endpoint needs an API key for the default public use case.

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Container health |
| `GET` | `/api/dashboards` | Dashboard summaries |
| `GET` | `/api/dashboards/:id` | Full JSON definition |
| `PUT` | `/api/dashboards/:id` | Validate and save a definition |
| `POST` | `/api/dashboards/import` | Validate and import a definition |
| `GET` | `/api/dashboards/:id/export` | Download a definition |
| `DELETE` | `/api/dashboards/:id` | Delete a dashboard |
| `GET` | `/published/:id` | Render the fast HTML view |

Saves are written to a temporary file and renamed into place so a partial write cannot replace the dashboard store. Each successful save increments `revision` and records `updatedAt`.

## Search homepage

Set `mode` to `search` and provide a `search` object. Supported providers are `google`, `duckduckgo`, and `bing`; the search form submits directly to the selected provider and does not proxy queries through Stratum.

## Security

- The server validates every saved document and limits request bodies to 256 KB.
- Internal HTML is sanitized in the browser and again when published.
- External pages run inside a restricted iframe sandbox.
- `EMBED_ORIGINS` controls which exact origins may appear in published pages. Keep the default restrictive in public deployments.
- Dashboard definitions are data. They are never evaluated as JavaScript.

Stratum currently assumes a trusted single-user or private-network deployment. Add authentication at the reverse proxy before exposing editor or API routes publicly.

## Commands

```bash
npm run dev     # frontend + API with live reload
npm run build   # type-check and compile the frontend
npm test        # contract tests
npm start       # serve the production build and API
```

## Project map

```text
src/                 React workspace and lazy editor
server/              persistence API and published HTML renderer
shared/              versioned dashboard contract and seed data
examples/            importable dashboard definitions
data/                runtime store (ignored by Git)
Dockerfile            production image
docker-compose.yml    app and persistent volume
```

---

<div align="center"><sub>Built to stay quick when the dashboard grows.</sub></div>
