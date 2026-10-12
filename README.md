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
PROMETHEUS_URL=http://prometheus.example.com:9090 npm run dev
```

The workspace opens at `http://localhost:5173`; Vite forwards API and published-view requests to the backend on port `8787`. The bottom of the sidebar shows the date and short SHA of the newest commit, read from `GET /api/release`. That route shells out to `git`, so it reports no release when the checkout has no `.git` directory, as in the production image.

## Prometheus metrics

The bundled **Overview** dashboard is Prometheus-backed: eleven panels of live PromQL built from the standard `prometheus_*` and `process_*` metrics, so it renders against any Prometheus datasource. Add your own queries by editing the dashboard JSON.

Point Stratum at a datasource with `PROMETHEUS_URL`. Everything else is optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROMETHEUS_URL` | unset | Prometheus base URL, for example `http://prometheus.example.com:9090` |
| `PROMETHEUS_TOKEN` | unset | Bearer token sent to Prometheus, never returned to the browser |
| `PROMETHEUS_CACHE_TTL_MS` | `10000` | Collapses identical panel queries into one upstream call |

```bash
PROMETHEUS_URL=http://prometheus.example.com:9090 npm run dev
```

or in `.env` for Docker Compose:

```bash
PROMETHEUS_URL=http://prometheus.example.com:9090 docker compose up --build
```

Without `PROMETHEUS_URL` the panels stay visible and explain that the datasource is unconfigured, instead of failing the page.

Add a panel through the dashboard JSON:

```json
{
  "id": "disk-free",
  "type": "prometheus",
  "title": "Filesystem free",
  "query": "100 * (1 - node_filesystem_avail_bytes / node_filesystem_size_bytes)",
  "format": "metric",
  "unit": "percent",
  "detail": "root volume utilisation",
  "range": "6h",
  "step": "5m",
  "grid": { "colSpan": 3 }
}
```

| Field | Meaning |
| --- | --- |
| `query` | Any PromQL expression, including ranges such as `[5m]` |
| `format` | `metric`, `chart`, `table`, or `targets` |
| `unit` | `number`, `bytes`, `percent`, `seconds`, `duration`, or `text` |
| `unitSuffix` | Trailing suffix appended after the unit, e.g. `/s` |
| `range` / `step` | Prometheus durations like `6h` and `1m`; capped at 30d and 15s |
| `refreshMs` | Client refresh interval, default 30000, minimum 5000 |
| `labels` | Label keys used for table rows, target names, and chart legends |

`format: "targets"` treats the value as scrape health, which suits `up`. Charts render one line per series, up to six, and expose a 1h/6h/24h/7d range selector. Panels pause polling while the browser tab is hidden and refresh as soon as it becomes visible again.

Panels query through `GET /api/prometheus/query` rather than talking to Prometheus from the browser, so the datasource URL, CORS rules, and credentials stay on the server. Queries are length-limited, checked against a conservative PromQL character set, and served from a short-lived cache.

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
| `section` | Full-width heading above a group of panels | `title` |
| `prometheus` | Live PromQL metric, chart, table, or target list | `query`, `format`, `unit` |

Use `grid.colSpan` from 1–12 to size a widget. On small screens, cards stack automatically. Change `theme.accent` to any six-digit hex color.

## Panel layout

Panels follow the conventions of monitoring UIs, so the JSON reads like the screen it produces:

- **`section`** is a full-width heading. Interleave it with panels to group them.
- **`format: "metric"`** renders a centred value with a unit suffix and a sparkline anchored to the bottom edge. Set `unit` for the base unit and `unitSuffix` for a trailing rate such as `/s`, which together produce values like `10.5 KiB/s`.
- **`format: "chart"`** renders one line per series with a value axis on the left, time on the bottom, dashed gridlines, and a legend underneath. Series use the default blue, green, yellow, red, purple, cyan palette in order.
- **`format: "targets"`** maps the sample value to scrape health, which suits `up`.
- Empty results render as `No data` instead of an empty card.

A chart panel takes a single PromQL expression, so label multiple series inside the query:

```promql
label_replace(sum(rate(http_requests_total[5m])), "dir", "Download", "", "")
  or label_replace(sum(rate(http_errors_total[5m])), "dir", "Errors", "", "")
```

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

Alongside the hourly strip and seven-day outlook, the view plots a 24-hour temperature chart comparing air and apparent temperature, a precipitation-probability chart, a wind-speed chart, and a daily high/low range chart with rainfall bars. Current conditions add surface pressure, today's high and low, and the wind bearing as a compass point, while the outlook column reports daily rainfall totals alongside the chance of rain. The published fast view renders the same additional figures and range and rainfall charts without the React runtime.

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
| `GET` | `/api/config` | Embed origins and datasource status |
| `GET` | `/api/release` | Date, short SHA, and subject of the newest commit |
| `GET` | `/api/prometheus/query` | Proxied PromQL range query |
| `GET` | `/published/:id` | Render the fast HTML view |

Saves are written to a temporary file and renamed into place so a partial write cannot replace the dashboard store. Each successful save increments `revision` and records `updatedAt`.

## Search homepage

Set `mode` to `search` and provide a `search` object. Supported providers are `google`, `duckduckgo`, and `bing`; the search form submits directly to the selected provider and does not proxy queries through Stratum.

## Security

- The server validates every saved document and limits request bodies to 256 KB.
- Internal HTML is sanitized in the browser and again when published.
- External pages run inside a restricted iframe sandbox.
- `EMBED_ORIGINS` controls which exact origins may appear in published pages. Keep the default restrictive in public deployments.
- The Prometheus endpoint and any bearer token live in the server environment. Neither is written into dashboard JSON, exports, or API responses, and the browser only ever sees the proxied results.
- Dashboard definitions are data. They are never evaluated as JavaScript.

Stratum currently assumes a trusted single-user or private-network deployment. Add authentication at the reverse proxy before exposing editor or API routes publicly.

## Commands

```bash
npm run dev     # frontend + API with live reload
npm run build   # type-check and compile the frontend
npm test        # contract, proxy, formatting, and component tests
npm start       # serve the production build and API
```

## Project map

```text
src/                 React workspace, lazy editor, and PromQL panels
server/              persistence API, Prometheus proxy, and published HTML renderer
shared/              versioned dashboard contract, Prometheus helpers, and seed data
examples/            importable dashboard definitions
data/                runtime store (ignored by Git)
Dockerfile            production image
docker-compose.yml    app and persistent volume
```

---

<div align="center"><sub>Built to stay quick when the dashboard grows.</sub></div>
