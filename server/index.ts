import express from "express";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sanitize from "sanitize-html";
import { dashboardSchema, defaultDashboard, searchDashboard, weatherDashboard, type Dashboard, type PrometheusWidget, type Widget } from "../shared/dashboard.js";
import { createPrometheus } from "./prometheus.js";
import { latestValue, presentValue, seriesName } from "../shared/prometheus.js";

const execFileAsync = promisify(execFile);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, "data"));
const dataFile = path.join(dataDir, "dashboards.json");
const embedOrigins = (process.env.EMBED_ORIGINS ?? "https://example.com").split(",").map((value) => value.trim()).filter(Boolean);
const prometheus = createPrometheus({
  url: process.env.PROMETHEUS_URL,
  token: process.env.PROMETHEUS_TOKEN,
  cacheTtlMs: Number(process.env.PROMETHEUS_CACHE_TTL_MS ?? 10_000)
});
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
const sanitizeHtml = (html: string) => sanitize(html, {
  allowedTags: ["p", "strong", "em", "b", "i", "small", "span", "br", "ul", "ol", "li", "a", "code", "pre", "blockquote"],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: { a: sanitize.simpleTransform("a", { rel: "noopener noreferrer" }, true) }
});

async function writeDashboards(dashboards: Dashboard[]) {
  await fs.mkdir(dataDir, { recursive: true });
  const temporary = `${dataFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(dashboards, null, 2));
  await fs.rename(temporary, dataFile);
}

async function readDashboards(): Promise<Dashboard[]> {
  let raw: string;
  try { raw = await fs.readFile(dataFile, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const seeded=[defaultDashboard,searchDashboard,weatherDashboard]; await writeDashboards(seeded); return seeded;
  }
  const dashboards=dashboardSchema.array().parse(JSON.parse(raw));
  const missing=[defaultDashboard,searchDashboard,weatherDashboard].filter((seed)=>!dashboards.some((item)=>item.id===seed.id));
  if(missing.length){dashboards.push(...missing);await writeDashboards(dashboards);}
  return dashboards;
}

/** Reads the newest commit so the sidebar can show a release date. Absent in images built without git metadata. */
let releaseCache: { date: string; sha: string; subject: string } | null | undefined;
async function readRelease() {
  if (releaseCache !== undefined) return releaseCache;
  try {
    await fs.access(path.join(root, ".git"));
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%cI%n%h%n%s"], { cwd: root, timeout: 3000 });
    const [date, sha, subject] = stdout.split("\n");
    releaseCache = date && sha ? { date, sha, subject: subject ?? "" } : null;
  } catch {
    releaseCache = null;
  }
  return releaseCache;
}

function isAllowedEmbed(url: string) { try { return embedOrigins.includes("*") || embedOrigins.includes(new URL(url).origin); } catch { return false; } }

function renderWidget(widget: Widget) {
  const span = `span ${widget.grid.colSpan}`;
  if (widget.type === "section") return `<h2 class="section-head" style="grid-column:${span}">${escapeHtml(widget.title)}</h2>`;
  if (widget.type === "metric") return `<article class="card metric" style="grid-column:${span}"><label>${escapeHtml(widget.title)}</label><strong>${escapeHtml(widget.value)}</strong><p>${escapeHtml(widget.detail)}</p></article>`;
  if (widget.type === "status") return `<article class="card" style="grid-column:${span}"><label>${escapeHtml(widget.title)}</label>${widget.items.map((item) => `<div class="status"><i></i><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.status)}</small></span><em>${escapeHtml(item.value)}</em></div>`).join("")}</article>`;
  if (widget.type === "links") return `<article class="card" style="grid-column:${span}"><label>${escapeHtml(widget.title)}</label>${widget.items.map((item) => `<a class="link" href="${escapeHtml(item.url)}" rel="noopener noreferrer"><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.hint)}</small></span><em>↗</em></a>`).join("")}</article>`;
  if (widget.type === "html") return `<article class="card prose" style="grid-column:${span}"><label>${escapeHtml(widget.title)}</label>${sanitizeHtml(widget.html)}</article>`;
  if (widget.type === "embed") return `<article class="card" style="grid-column:${span}"><label>${escapeHtml(widget.title)}</label>${isAllowedEmbed(widget.url) ? `<iframe title="${escapeHtml(widget.title)}" src="${escapeHtml(widget.url)}" sandbox="allow-scripts allow-forms allow-popups" style="height:${widget.height}px"></iframe>` : `<p>Embed origin is not allowed by this server.</p>`}</article>`;
  if (widget.type !== "chart") return "";
  const max = Math.max(...widget.values, 1);
  return `<article class="card chart" style="grid-column:${span}"><label>${escapeHtml(widget.title)}</label><strong>${escapeHtml(widget.value)}</strong><small>${escapeHtml(widget.detail)}</small><div class="bars">${widget.values.map((value) => `<i style="height:${Math.max(5, (value / max) * 100)}%"></i>`).join("")}</div></article>`;
}

/** Renders a live PromQL panel for the dependency-free published HTML view. */
async function renderPrometheusWidget(widget: PrometheusWidget) {
  const span = `span ${widget.grid.colSpan}`;
  const result = await prometheus.query(widget.query, widget.range, widget.step);
  const label = `<label>${escapeHtml(widget.title)}</label>`;
  const note = widget.detail ? `<small>${escapeHtml(widget.detail)}</small>` : "";
  if (!result.ok) return `<article class="card" style="grid-column:${span}">${label}<p>${escapeHtml(result.error ?? "No data")}</p></article>`;

  const value = latestValue(result.series);
  const formatted = presentValue(value, widget.unit, widget.unitSuffix);

  if (widget.format === "metric") {
    const points = (result.series[0]?.points ?? []).slice(-60);
    const numbers = points.map(([, point]) => point).filter((point): point is number => point !== null);
    let trend = "";
    if (numbers.length > 1) {
      const low = Math.min(0, ...numbers);
      const span = Math.max(...numbers) - low || 1;
      const path = points.map(([, point], index) => {
        const x = points.length > 1 ? (index / (points.length - 1)) * 100 : 50;
        const y = 44 - (((point ?? low) - low) / span) * 40;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      }).join(" ");
      trend = `<svg class="stat-spark" viewBox="0 0 100 44" preserveAspectRatio="none"><path d="${path}"/></svg>`;
    }
    const empty = value === null ? `<p class="panel-state">No data</p>` : `<div class="stat-value"><strong>${escapeHtml(formatted.text)}</strong>${formatted.suffix ? `<em>${escapeHtml(formatted.suffix)}</em>` : ""}</div>${trend}`;
    return `<article class="card stat-card" style="grid-column:${span}">${label}${note}${empty}</article>`;
  }

  if (widget.format === "targets") {
    const up = result.series.filter((entry) => latestValue([entry]) === 1).length;
    const rows = result.series.map((entry) => {
      const state = entry.stale || latestValue([entry]) !== 1;
      return `<div class="status"><i class="${state ? "down" : ""}"></i><span><b>${escapeHtml(seriesName(entry.labels, widget.labels))}</b><small>${state ? "Down" : "Up"}</small></span><em>${escapeHtml(seriesName(entry.labels, ["instance"]))}</em></div>`;
    }).join("");
    return `<article class="card" style="grid-column:${span}">${label}${note}<div class="status"><i></i><span><b>${up} of ${result.series.length} up</b><small>Prometheus targets</small></span></div>${rows}</article>`;
  }

  if (widget.format === "table") {
    const rows = result.series.map((entry) => {
      const shown = presentValue(latestValue([entry]), widget.unit, widget.unitSuffix);
      return `<div class="status"><i></i><span><b>${escapeHtml(seriesName(entry.labels, widget.labels))}</b><small>${escapeHtml(entry.labels.instance ?? "")}</small></span><em>${escapeHtml(`${shown.text} ${shown.suffix}`.trim())}</em></div>`;
    }).join("");
    return `<article class="card" style="grid-column:${span}">${label}${note}${rows || "<p>No series returned</p>"}</article>`;
  }

  const series = result.series.slice(0, 6);
  const max = Math.max(1, ...series.flatMap((entry) => entry.points.map(([, v]) => v ?? 0)));
  const sparkline = (points: [number, number | null][]) => points.slice(-40).map(([, v]) => `<i style="height:${Math.max(5, ((v ?? 0) / max) * 100)}%"></i>`).join("");
  const rows = series.map((entry) => `<div class="chart-row"><label>${escapeHtml(seriesName(entry.labels, widget.labels))}</label><div class="bars">${sparkline(entry.points)}</div></div>`).join("");
  return `<article class="card chart" style="grid-column:${span}">${label}<strong>${escapeHtml(formatted.text)} ${escapeHtml(formatted.suffix)}</strong>${note}${rows || "<p>No series returned</p>"}</article>`;
}

function page(dashboard: Dashboard, content: string) {
  const accent = dashboard.theme.accent;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(dashboard.title)} · Stratum</title><style>*{box-sizing:border-box}body{margin:0;background:#090c10;color:#eef1f4;font:15px system-ui,sans-serif;min-height:100vh;padding:clamp(14px,2vw,28px);--a:${accent}}header{width:100%;margin:0 0 20px;display:flex;justify-content:space-between;align-items:end}h1{font-size:clamp(30px,3vw,46px);letter-spacing:-.04em;margin:7px 0}p{color:#818895}label{font:11px ui-monospace;letter-spacing:.12em;color:#7f8792}header>span{font:11px ui-monospace;color:#69717c}main{width:100%;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:10px}.card{background:#12161c;border:1px solid #282d36;border-radius:10px;padding:18px;min-height:154px}.section-head{grid-column:span 12;margin:14px 0 0;font:600 17px system-ui;color:#e8eaed}.section-head:first-child{margin-top:0}.stat-card{display:flex;flex-direction:column;min-height:118px}.stat-card .stat-value{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;margin:6px 0}.stat-card .stat-value strong{font:600 38px ui-monospace;letter-spacing:-.02em;color:#f5f7fa}.stat-card .stat-value em{font-style:normal;font-size:16px;color:#9aa4b2}.stat-spark{display:block;width:100%;height:44px;margin-top:auto}.stat-spark path{fill:none;stroke:#3d8bfd;stroke-width:1.5;vector-effect:non-scaling-stroke}.panel-state{display:grid;place-content:center;text-align:center;color:#6d7481;font-size:12px;min-height:60px}.stat-card>.panel-state{flex:1}.card>label{display:block;margin-bottom:18px}.metric strong,.chart strong{display:block;font:500 42px ui-monospace;letter-spacing:-.06em}.card p,.chart small{color:#7d8590}.status,.link{display:flex;align-items:center;gap:12px;border-top:1px solid #252a32;padding:10px 0}.status i{width:7px;height:7px;border-radius:50%;background:var(--a)}.status span,.link span{display:grid;gap:3px}.status small,.link small{font-size:11px;color:#737b86}.status em,.link em{margin-left:auto;font:11px ui-monospace;font-style:normal;color:#9ca3ac}.link{color:#eef1f4;text-decoration:none}.bars{height:150px;display:flex;align-items:end;gap:5px;margin-top:16px}.bars i{flex:1;background:color-mix(in srgb,var(--a) 55%,#1f252c);border-radius:3px 3px 0 0}.prose strong{font-size:20px}.prose p{max-width:75ch}iframe{display:block;border:0;width:100%;border-radius:8px;background:white}.search{max-width:900px;margin:18vh auto;text-align:center}.logo{width:46px;display:grid;gap:7px;margin:auto}.logo i{height:15px;background:var(--a);border-radius:3px}.logo i:last-child{width:65%;background:#8f7cff}.search h1{margin:24px}.search form{display:flex;background:#151920;border:1px solid #323844;border-radius:14px;padding:7px}.search input{flex:1;background:transparent;border:0;color:white;font-size:17px;padding:12px;outline:0}.search button{background:var(--a);border:0;border-radius:8px;padding:0 20px;font-weight:700}.search nav{display:flex;justify-content:center;gap:14px;margin-top:30px;flex-wrap:wrap}.search nav a{color:#cdd2d9;text-decoration:none;display:grid;gap:8px}.search nav b{width:54px;height:54px;border:1px solid #303641;background:#14181e;border-radius:12px;display:grid;place-content:center;font:13px ui-monospace}.search nav span{font-size:12px}.weather-published{display:grid;grid-template-columns:repeat(7,1fr);gap:10px}.weather-hero{grid-column:span 3;background:#121820;border:1px solid #29333c;border-radius:12px;padding:28px;min-height:310px}.weather-hero .symbol{font-size:72px;line-height:1}.weather-hero strong{display:block;font-size:78px;letter-spacing:-.08em;margin-top:26px}.weather-hero p{font-size:18px}.forecast{grid-column:span 4;background:#12161c;border:1px solid #29333c;border-radius:12px;padding:20px}.forecast>div{display:grid;grid-template-columns:1fr 50px 1fr 80px;align-items:center;border-top:1px solid #252e36;min-height:52px}.forecast span{text-align:center;font-size:25px}.forecast small{color:#7e8993}.forecast b:last-child{text-align:right}@media(max-width:800px){main{display:block}.card{margin-bottom:10px}header{align-items:start}.search form{padding:5px}.search button{padding:0 14px}.weather-published{display:block}.weather-hero,.forecast{margin-bottom:10px}.forecast>div{grid-template-columns:70px 45px 1fr 68px}}</style></head><body>${content}</body></html>`;
}

const weatherSymbol=(code:number)=>code===0?"☀":code<=2?"⛅":code===3||code===45||code===48?"☁":code>=71&&code<=77?"❄":code>=95?"⚡":"☂";

async function renderPublished(dashboard: Dashboard) {
  if (dashboard.mode === "search") {
    const search = dashboard.search!;
    const providers = { google: "https://www.google.com/search", duckduckgo: "https://duckduckgo.com/", bing: "https://www.bing.com/search" };
    return page(dashboard, `<section class="search"><div class="logo"><i></i><i></i></div><h1>${escapeHtml(dashboard.title)}</h1><form action="${providers[search.provider]}"><input name="q" autofocus placeholder="${escapeHtml(search.placeholder)}"><button>Search</button></form><nav>${search.shortcuts.map((item) => `<a href="${escapeHtml(item.url)}" rel="noopener"><b>${escapeHtml(item.label.slice(0, 2).toUpperCase())}</b><span>${escapeHtml(item.label)}</span></a>`).join("")}</nav></section>`);
  }
  if(dashboard.mode==="weather"){
    const config=dashboard.weather!;const params=new URLSearchParams({latitude:String(config.latitude),longitude:String(config.longitude),current:"temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",daily:"weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",timezone:"auto",forecast_days:"7",temperature_unit:config.temperatureUnit});
    try{const response=await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);if(!response.ok)throw new Error("weather request failed");const data=await response.json() as {current:{temperature_2m:number;apparent_temperature:number;relative_humidity_2m:number;weather_code:number;wind_speed_10m:number};current_units:{temperature_2m:string;wind_speed_10m:string};daily:{time:string[];weather_code:number[];temperature_2m_max:number[];temperature_2m_min:number[];precipitation_probability_max:number[]}};return page(dashboard,`<header><div><label>LIVE WEATHER</label><h1>${escapeHtml(config.location)}</h1><p>${config.latitude.toFixed(2)}°, ${config.longitude.toFixed(2)}°</p></div><span>OPEN-METEO</span></header><section class="weather-published"><article class="weather-hero"><div class="symbol">${weatherSymbol(data.current.weather_code)}</div><strong>${Math.round(data.current.temperature_2m)}${escapeHtml(data.current_units.temperature_2m)}</strong><p>Feels like ${Math.round(data.current.apparent_temperature)}° · Humidity ${data.current.relative_humidity_2m}% · Wind ${Math.round(data.current.wind_speed_10m)} ${escapeHtml(data.current_units.wind_speed_10m)}</p></article><article class="forecast"><label>7-DAY OUTLOOK</label>${data.daily.time.map((date,index)=>`<div><b>${index===0?"Today":new Date(`${date}T12:00:00`).toLocaleDateString("en",{weekday:"short"})}</b><span>${weatherSymbol(data.daily.weather_code[index])}</span><small>${data.daily.precipitation_probability_max[index]}% rain</small><b>${Math.round(data.daily.temperature_2m_max[index])}° / ${Math.round(data.daily.temperature_2m_min[index])}°</b></div>`).join("")}</article></section>`);}catch{return page(dashboard,`<header><div><label>LIVE WEATHER</label><h1>${escapeHtml(config.location)}</h1></div></header><main><article class="card" style="grid-column:span 12"><h2>Forecast temporarily unavailable</h2><p>Refresh this page to try again.</p></article></main>`)}
  }
  return page(dashboard, `<header><div><label>DASHBOARD / ${escapeHtml(dashboard.id)}</label><h1>${escapeHtml(dashboard.title)}</h1><p>${escapeHtml(dashboard.description)}</p></div><span>REV ${dashboard.revision}</span></header><main>${(await Promise.all(dashboard.widgets.map((widget) => widget.type === "prometheus" ? renderPrometheusWidget(widget) : renderWidget(widget)))).join("")}</main>`);
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/api/config", (_request, response) => response.json({ embedOrigins, prometheus: { configured: prometheus.configured, url: process.env.PROMETHEUS_URL ?? null } }));
  app.get("/api/release", async (_request, response, next) => { try { response.json({ release: await readRelease() }); } catch (error) { next(error); } });
  app.get("/api/prometheus/query", async (request, response, next) => {
    try {
      const query = String(request.query.query ?? "");
      if (!query) return response.status(400).json({ error: "A PromQL query is required" });
      if (query.length > 2000) return response.status(400).json({ error: "Query is too long" });
      const result = await prometheus.query(query, String(request.query.range ?? "6h"), String(request.query.step ?? "1m"));
      result.ok ? response.json(result) : response.status(502).json(result);
    } catch (error) { next(error); }
  });
  app.get("/api/dashboards", async (_request, response, next) => { try { response.json((await readDashboards()).map(({ widgets, ...item }) => ({ ...item, widgetCount: widgets.length }))); } catch (error) { next(error); } });
  app.get("/api/dashboards/:id/export", async (request, response, next) => { try { const item=(await readDashboards()).find((dashboard)=>dashboard.id===request.params.id); if(!item)return response.status(404).json({error:"Dashboard not found"}); response.set({"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="${item.id}.json"`}).send(JSON.stringify(item,null,2)); } catch(error){next(error);} });
  app.get("/api/dashboards/:id", async (request, response, next) => { try { const item = (await readDashboards()).find((dashboard) => dashboard.id === request.params.id); item ? response.json(item) : response.status(404).json({ error: "Dashboard not found" }); } catch (error) { next(error); } });
  app.put("/api/dashboards/:id", async (request, response, next) => {
    try {
      const parsed = dashboardSchema.safeParse({ ...request.body, id: request.params.id });
      if (!parsed.success) return response.status(400).json({ error: "Dashboard definition is invalid", issues: parsed.error.issues });
      const dashboards = await readDashboards(); const current = dashboards.find((item) => item.id === request.params.id);
      const saved = { ...parsed.data, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
      const index = dashboards.findIndex((item) => item.id === saved.id); index >= 0 ? dashboards.splice(index, 1, saved) : dashboards.push(saved);
      await writeDashboards(dashboards); response.json(saved);
    } catch (error) { next(error); }
  });
  app.post("/api/dashboards/import", async (request, response, next) => { try { const parsed=dashboardSchema.safeParse(request.body); if(!parsed.success)return response.status(400).json({error:"Dashboard definition is invalid",issues:parsed.error.issues}); const dashboards=await readDashboards(); const current=dashboards.find((item)=>item.id===parsed.data.id); const saved={...parsed.data,revision:(current?.revision??0)+1,updatedAt:new Date().toISOString()}; const index=dashboards.findIndex((item)=>item.id===saved.id); index>=0?dashboards.splice(index,1,saved):dashboards.push(saved); await writeDashboards(dashboards); response.status(current?200:201).json(saved); } catch(error){next(error);} });
  app.delete("/api/dashboards/:id", async (request, response, next) => { try { const dashboards = await readDashboards(); const remaining = dashboards.filter((item) => item.id !== request.params.id); if (remaining.length === dashboards.length) return response.status(404).json({ error: "Dashboard not found" }); await writeDashboards(remaining); response.status(204).end(); } catch (error) { next(error); } });
  app.get("/published/:id", async (request, response, next) => { try { const item = (await readDashboards()).find((dashboard) => dashboard.id === request.params.id); if (!item) return response.status(404).send("Dashboard not found"); response.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-src https:; form-action https:; base-uri 'none'" }).send(await renderPublished(item)); } catch (error) { next(error); } });
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.use((request, response, next) => request.method === "GET" && !request.path.startsWith("/api/") ? response.sendFile(path.join(dist, "index.html"), (error) => error ? next() : undefined) : next());
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => { console.error(error); response.status(500).json({ error: "The dashboard store is temporarily unavailable" }); });
  return app;
}

if (process.env.NODE_ENV !== "test") createApp().listen(Number(process.env.PORT ?? 8787), "0.0.0.0", () => console.log("Stratum API listening on http://localhost:8787"));
