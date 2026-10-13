import express from "express";
import { promises as fs, constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sanitize from "sanitize-html";
import { dashboardSchema, defaultDashboard, searchDashboard, weatherDashboard, type Dashboard, type PrometheusWidget, type Widget } from "../shared/dashboard.js";
import { createPrometheus } from "./prometheus.js";
import { axisTicks, latestValue, presentValue, seriesName } from "../shared/prometheus.js";
import { areaPath, barsFor, dayName, describeWeather, GEOMETRY, linePath, rainTint, scaleDomain, timeAxis, toPoints, yPosition, type Point, type Scale } from "../shared/weather.js";

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
let releaseCache: { value: { date: string; sha: string; subject: string } | null; at: number } | undefined;
async function readRelease() {
  if (releaseCache && Date.now() - releaseCache.at < 60_000) return releaseCache.value;
  let value: { date: string; sha: string; subject: string } | null = null;
  try {
    await fs.access(path.join(root, ".git"));
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%cI%n%h%n%s"], { cwd: root, timeout: 3000 });
    const [date, sha, subject] = stdout.split("\n");
    if (date && sha) value = { date, sha, subject: subject ?? "" };
  } catch {
    value = null;
  }
  releaseCache = { value, at: Date.now() };
  return value;
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(dashboard.title)} · Stratum</title><style>*{box-sizing:border-box}body{margin:0;background:#090c10;color:#eef1f4;font:15px system-ui,sans-serif;min-height:100vh;padding:clamp(14px,2vw,28px);--a:${accent}}header{width:100%;margin:0 0 20px;display:flex;justify-content:space-between;align-items:end}h1{font-size:clamp(30px,3vw,46px);letter-spacing:-.04em;margin:7px 0}p{color:#818895}label{font:11px ui-monospace;letter-spacing:.12em;color:#7f8792}header>span{font:11px ui-monospace;color:#69717c}main{width:100%;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:10px}.card{background:#12161c;border:1px solid #282d36;border-radius:10px;padding:18px;min-height:154px}.section-head{grid-column:span 12;margin:14px 0 0;font:600 17px system-ui;color:#e8eaed}.section-head:first-child{margin-top:0}.stat-card{display:flex;flex-direction:column;min-height:118px}.stat-card .stat-value{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;margin:6px 0}.stat-card .stat-value strong{font:600 38px ui-monospace;letter-spacing:-.02em;color:#f5f7fa}.stat-card .stat-value em{font-style:normal;font-size:16px;color:#9aa4b2}.stat-spark{display:block;width:100%;height:44px;margin-top:auto}.stat-spark path{fill:none;stroke:#3d8bfd;stroke-width:1.5;vector-effect:non-scaling-stroke}.panel-state{display:grid;place-content:center;text-align:center;color:#6d7481;font-size:12px;min-height:60px}.stat-card>.panel-state{flex:1}.card>label{display:block;margin-bottom:18px}.metric strong,.chart strong{display:block;font:500 42px ui-monospace;letter-spacing:-.06em}.card p,.chart small{color:#7d8590}.status,.link{display:flex;align-items:center;gap:12px;border-top:1px solid #252a32;padding:10px 0}.status i{width:7px;height:7px;border-radius:50%;background:var(--a)}.status span,.link span{display:grid;gap:3px}.status small,.link small{font-size:11px;color:#737b86}.status em,.link em{margin-left:auto;font:11px ui-monospace;font-style:normal;color:#9ca3ac}.link{color:#eef1f4;text-decoration:none}.bars{height:150px;display:flex;align-items:end;gap:5px;margin-top:16px}.bars i{flex:1;background:color-mix(in srgb,var(--a) 55%,#1f252c);border-radius:3px 3px 0 0}.prose strong{font-size:20px}.prose p{max-width:75ch}iframe{display:block;border:0;width:100%;border-radius:8px;background:white}.search{max-width:900px;margin:18vh auto;text-align:center}.logo{width:46px;display:grid;gap:7px;margin:auto}.logo i{height:15px;background:var(--a);border-radius:3px}.logo i:last-child{width:65%;background:#8f7cff}.search h1{margin:24px}.search form{display:flex;background:#151920;border:1px solid #323844;border-radius:14px;padding:7px}.search input{flex:1;background:transparent;border:0;color:white;font-size:17px;padding:12px;outline:0}.search button{background:var(--a);border:0;border-radius:8px;padding:0 20px;font-weight:700}.search nav{display:flex;justify-content:center;gap:14px;margin-top:30px;flex-wrap:wrap}.search nav a{color:#cdd2d9;text-decoration:none;display:grid;gap:8px}.search nav b{width:54px;height:54px;border:1px solid #303641;background:#14181e;border-radius:12px;display:grid;place-content:center;font:13px ui-monospace}.search nav span{font-size:12px}.weather-published,.wp-top,.wp-charts,.wp-week{display:grid;gap:10px}.wp-top{grid-template-columns:4fr 5fr 3fr;margin-bottom:10px}.wp-charts{grid-template-columns:repeat(2,minmax(0,1fr))}.wp-week{grid-template-columns:repeat(7,minmax(0,1fr));margin-bottom:10px}
.wp-now{background:#121820;border:1px solid #29333c;border-radius:12px;padding:22px;display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:0}.wp-now .wp-symbol{font-size:52px;line-height:1;color:var(--a)}.wp-now p{margin:10px 0 0;font-size:13px}.wp-now strong{display:block;font-size:60px;letter-spacing:-.07em;line-height:1}.wp-now sup{font-size:16px;letter-spacing:0;color:var(--a);vertical-align:top;margin-left:4px}
.wp-now dl{display:grid;grid-template-columns:repeat(2,1fr);gap:12px 18px;margin:20px 0 0;padding-top:16px;border-top:1px solid #252a32}.wp-now dt{font:10px ui-monospace;letter-spacing:.1em;color:#6f7783;text-transform:uppercase;margin-bottom:4px}.wp-now dd{margin:0;font:500 15px ui-monospace;color:#e7eaee}
.wp-sun{padding:18px 20px;min-width:0;display:flex;flex-direction:column}.card>label{display:flex;flex-direction:column;gap:4px;margin-bottom:14px}.card>label b{font:600 17px system-ui;color:#e8eaed;letter-spacing:-.01em}.card>label em{margin-left:auto;font-style:normal;font:11px ui-monospace;color:#8a939e}
.wp-arc{margin-bottom:auto}.wp-arc svg{display:block;width:100%;height:92px;overflow:visible}.wp-arc-horizon{stroke:#232c35;stroke-width:1;vector-effect:non-scaling-stroke}.wp-arc-path{fill:none;stroke:#2c3a44;stroke-width:1.4;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}.wp-arc-done{fill:none;stroke:var(--a);stroke-width:1.8;stroke-linecap:round;vector-effect:non-scaling-stroke;opacity:.85}.wp-arc-body{fill:#ffd166;stroke:#ffb547;stroke-width:.5;vector-effect:non-scaling-stroke}
.wp-arc-ends{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-top:6px;font:9px/1.5 ui-monospace;letter-spacing:.1em;color:#5f6b77;text-transform:uppercase}.wp-arc-ends b{display:block;font-size:14px;letter-spacing:0;color:#dbe3ea;text-transform:none}.wp-arc-ends>span:last-child{text-align:right}.wp-arc-mid{color:var(--a);padding-top:2px}
.wp-sun-facts{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 18px;margin:14px 0 0;padding-top:14px;border-top:1px solid #252a32;list-style:none}.wp-sun-facts dt{font:10px ui-monospace;letter-spacing:.1em;color:#6f7783;text-transform:uppercase;margin-bottom:3px}.wp-sun-facts dd{margin:0;font:500 15px ui-monospace;color:#e7eaee}
.wp-day{padding:14px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;min-width:0}.wp-day>label{margin:0;font-size:11px;color:#8a939e}.wp-day-symbol{font-size:26px;line-height:1}.wp-day p{margin:0;font-size:11px;color:#7d8590;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.wp-day dl{display:flex;gap:12px;margin:2px 0 0}.wp-day dl div{display:flex;gap:4px;align-items:baseline}.wp-day dt{font:10px ui-monospace;color:#6f7783}.wp-day dd{margin:0;font:10px ui-monospace;color:#8d95a1}.wp-day strong{font:500 19px ui-monospace;letter-spacing:-.03em}.wp-day small{color:#767e8a;margin-left:5px;font-size:14px}
.wp-section-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:22px 0 10px;font:600 11px ui-monospace;letter-spacing:.12em;color:var(--a)}.wp-section-head em{font:400 11px ui-monospace;font-style:normal;color:#7d8590;letter-spacing:.04em}
.wp-card{padding:16px 18px 14px;min-width:0;display:flex;flex-direction:column}.wp-plot{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px}.wp-yaxis{position:relative;height:var(--plot,220px)}.wp-yaxis ul{position:absolute;inset:0;margin:0;padding:0;list-style:none}.wp-yaxis li{position:absolute;right:0;transform:translateY(50%);font:10px ui-monospace;color:#6b7280;white-space:nowrap}
.wp-main{min-width:0;display:grid;grid-template-rows:auto auto;gap:6px}.wp-main>svg{width:100%;height:var(--plot,220px);display:block;overflow:visible}
.wp-grid{stroke:#2a2f38;stroke-width:1;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}.wp-line{fill:none;stroke-width:1.7;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}.wp-band{opacity:.14;stroke:none}.wp-bar{opacity:.85}
.wp-range-bar rect{fill:#3d8bfd;opacity:.45}.wp-range-bar .wp-range-max{fill:#5fa0ff}.wp-range-bar .wp-range-min{fill:#ff9f43}
.wp-axis{display:flex;justify-content:space-between;margin-top:6px;font:10px ui-monospace;color:#5f6672}.wp-legend{display:flex;justify-content:center;flex-wrap:wrap;gap:8px 20px;margin:14px 0 0}.wp-legend span{display:flex;align-items:center;gap:7px;font-size:11px;color:#8b939f}.wp-legend i{width:9px;height:9px;border-radius:50%;flex:none;display:block}
@media(max-width:1100px){.wp-top{grid-template-columns:1fr 1fr}.wp-charts{grid-template-columns:1fr}.wp-week{grid-template-columns:repeat(4,1fr)}}
@media(max-width:800px){.wp-top{grid-template-columns:1fr}.wp-week{grid-template-columns:repeat(2,1fr)}.wp-charts{--plot:180px}.wp-now dl{grid-template-columns:repeat(2,1fr)}}</style></head><body>${content}</body></html>`;
}

const weatherSymbol=(code:number)=>code===0?"☀":code<=2?"⛅":code===3||code===45||code===48?"☁":code>=71&&code<=77?"❄":code>=95?"⚡":"☂";

type PublishedSeries={name:string;color:string;points:Point[]};

/** Formats a published y axis tick the same way the React dashboard does. */
function publishedTick(value:number,kind:"temperature"|"percent"|"mm"|"speed",unit="") {
  if(kind==="percent")return `${Math.round(value)}%`;
  if(kind==="temperature")return `${Math.round(value)}°`;
  if(kind==="mm")return value%1===0?`${value.toFixed(0)}`:`${value.toFixed(1)}`;
  if(kind==="speed")return unit?`${Math.round(value)} ${escapeHtml(unit)}`:`${Math.round(value)}`;
  return Number.isInteger(value)?`${value}`:value.toFixed(1);
}

/** SVG chart for the dependency-free published view; shares its scaling with the React dashboard. */
function publishedChart({title,subtitle,summary,scale,kind,unit,labels,series,markup,bars}:{title:string;subtitle:string;summary?:string;scale:Scale;kind:"temperature"|"percent"|"mm"|"speed";unit?:string;labels:{index:number;label:string}[];series?:PublishedSeries[];markup?:string;bars?:{x:number;y:number;width:number;height:number;value:number;color?:string}[]}) {
  const grid=scale.ticks.map((tick)=>`<line class="wp-grid" x1="0" y1="${yPosition(tick,scale).toFixed(2)}" x2="${GEOMETRY.width}" y2="${yPosition(tick,scale).toFixed(2)}"/>`).join("");
  const band=series?.[0]?`<path class="wp-band" style="fill:${series[0].color}" d="${areaPath(series[0].points,scale)}"/>`:"";
  const lines=(series??[]).map((entry)=>`<path class="wp-line" style="stroke:${entry.color}" d="${linePath(entry.points,scale)}"/>`).join("");
  const columns=(bars??[]).map((bar)=>`<rect class="wp-bar" style="fill:${bar.color??"#3d8bfd"}" x="${bar.x.toFixed(2)}" y="${bar.y.toFixed(2)}" width="${bar.width.toFixed(2)}" height="${bar.height.toFixed(2)}" rx="0.6"/>`).join("");
  const axis=scale.ticks.map((tick)=>`<li style="bottom:${((yPosition(tick,scale)/GEOMETRY.height)*100).toFixed(2)}%">${publishedTick(tick,kind,unit)}</li>`).join("");
  const legend=(series??[]).map((entry)=>`<span><i style="background:${entry.color}"></i>${escapeHtml(entry.name)}</span>`).join("");
  return `<article class="card wp-card"><label>${escapeHtml(subtitle)}<b>${escapeHtml(title)}</b>${summary?`<em>${escapeHtml(summary)}</em>`:""}</label><div class="wp-plot"><div class="wp-yaxis"><ul>${axis}</ul></div><div class="wp-main"><svg viewBox="0 0 ${GEOMETRY.width} ${GEOMETRY.height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(subtitle)} chart">${grid}${markup??""}${band}${lines}${columns}</svg><div class="wp-axis">${labels.map((entry)=>`<span>${escapeHtml(entry.label)}</span>`).join("")}</div></div></div>${legend?`<footer class="wp-legend">${legend}</footer>`:""}</article>`;
}

/** Daily high/low bars, drawn against the same scale as the hourly charts. */
function publishedRangeChart(days:{date:string;max:number;min:number}[],scale:Scale,labels:{index:number;label:string}[],unit:string) {
  const body=days.map((day,index)=>{
    const slot=GEOMETRY.width/days.length;
    const x=index*slot+slot/2;
    const width=slot*0.36;
    const top=yPosition(day.max,scale),bottom=yPosition(day.min,scale);
    return `<g class="wp-range-bar"><rect x="${(x-width/2).toFixed(2)}" y="${top.toFixed(2)}" width="${width.toFixed(2)}" height="${Math.max(1,bottom-top).toFixed(2)}" rx="1"/><circle cx="${x.toFixed(2)}" cy="${top.toFixed(2)}" r="1.15" class="wp-range-max"/><circle cx="${x.toFixed(2)}" cy="${bottom.toFixed(2)}" r="1.15" class="wp-range-min"/></g>`;
  }).join("");
  return publishedChart({title:"Highs and lows",subtitle:"7-DAY TEMPERATURE",scale,kind:"temperature",unit,labels,markup:body,series:[{name:"Daily high",color:"#5fa0ff",points:[]},{name:"Daily low",color:"#ff9f43",points:[]}]});
}

async function renderPublished(dashboard: Dashboard) {
  if (dashboard.mode === "search") {
    const search = dashboard.search!;
    const providers = { google: "https://www.google.com/search", duckduckgo: "https://duckduckgo.com/", bing: "https://www.bing.com/search" };
    return page(dashboard, `<section class="search"><div class="logo"><i></i><i></i></div><h1>${escapeHtml(dashboard.title)}</h1><form action="${providers[search.provider]}"><input name="q" autofocus placeholder="${escapeHtml(search.placeholder)}"><button>Search</button></form><nav>${search.shortcuts.map((item) => `<a href="${escapeHtml(item.url)}" rel="noopener"><b>${escapeHtml(item.label.slice(0, 2).toUpperCase())}</b><span>${escapeHtml(item.label)}</span></a>`).join("")}</nav></section>`);
  }
  if(dashboard.mode==="weather"){
    const config=dashboard.weather!;
    const params=new URLSearchParams({latitude:String(config.latitude),longitude:String(config.longitude),current:"temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,is_day",hourly:"temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,uv_index,visibility",daily:"weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max",timezone:"auto",forecast_days:"7",temperature_unit:config.temperatureUnit});
    try{
      const response=await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if(!response.ok)throw new Error("weather request failed");
      const data=await response.json() as {timezone_abbreviation:string;current:{time:string;temperature_2m:number;apparent_temperature:number;relative_humidity_2m:number;weather_code:number;wind_speed_10m:number;wind_direction_10m:number;surface_pressure:number;is_day:number};current_units:{temperature_2m:string;wind_speed_10m:string;surface_pressure:string;precipitation:string};hourly:{time:string[];temperature_2m:number[];apparent_temperature:number[];relative_humidity_2m:number[];precipitation_probability:number[];precipitation:number[];weather_code:number[];wind_speed_10m:number[];wind_gusts_10m:number[];uv_index:number[];visibility:number[]};daily:{time:string[];weather_code:number[];temperature_2m_max:number[];temperature_2m_min:number[];sunrise:string[];sunset:string[];precipitation_probability_max:number[];precipitation_sum:number[];wind_speed_10m_max:number[];wind_gusts_10m_max:number[];uv_index_max:number[]}};
      const unit=data.current_units.temperature_2m,speed=data.current_units.wind_speed_10m;
      const compass=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(((data.current.wind_direction_10m%360)+360)%360/22.5)%16];
      const hours=data.hourly.time.length-1;
      const startHour=Math.max(0,data.hourly.time.findIndex((time)=>time>=data.current.time));
      const window=(values:number[])=>values.slice(startHour,startHour+48);
      const labels=timeAxis(data.hourly.time.slice(startHour,startHour+48),8);
      const dailyLabels=data.daily.time.map((date,index)=>({index,label:dayName(date,index)}));
      const summary=(values:number[],format:(value:number)=>string)=>values.length?`${format(Math.min(...values))} – ${format(Math.max(...values))}`:"";
      const tempSummary=summary(window(data.hourly.temperature_2m),(value)=>`${Math.round(value)}°`);
      const sun=data.daily.sunrise[0],set=data.daily.sunset[0];
      const stamp=(value:string)=>new Date(value).toLocaleTimeString(undefined,{hour:"numeric"});
      const now=new Date(data.current.time).getTime(),rise=new Date(sun).getTime(),down=new Date(set).getTime();
      const daylight=Math.max(down-rise,1);
      const progress=Math.min(Math.max((now-rise)/daylight,0),1);
      const arcX=4+progress*92,arcY=46-Math.sin(progress*Math.PI)*34;
      const arc=`${progress>=0&&progress<=1?`<path class="wp-arc-done" d="M4 46 A 46 40 0 0 1 96 46" pathLength="1" stroke-dasharray="${progress} 1"/>`:""}<circle class="wp-arc-body" cx="${arcX.toFixed(2)}" cy="${arcY.toFixed(2)}" r="3"/>`;
      const detail=[
        ["humidity",`${data.current.relative_humidity_2m}%`],
        ["wind",`${Math.round(data.current.wind_speed_10m)} ${speed} ${compass}`],
        ["rain",`${data.daily.precipitation_sum[0]} mm`],
        ["pressure",`${Math.round(data.current.surface_pressure)} hPa`],
        ["feels like",`${Math.round(data.current.apparent_temperature)}${unit}`],
        ["visibility",`${(data.hourly.visibility[startHour]/1000).toFixed(1)} km`]
      ];
      const charts=[
        publishedChart({title:"Temperature",subtitle:"AIR VS FEELS LIKE",summary:tempSummary,scale:scaleDomain([...window(data.hourly.temperature_2m),...window(data.hourly.apparent_temperature)]),kind:"temperature",labels,series:[{name:"Air",color:"#3d8bfd",points:toPoints(window(data.hourly.temperature_2m))},{name:"Feels like",color:"#ff9f43",points:toPoints(window(data.hourly.apparent_temperature))}]}),
        publishedChart({title:"Chance of rain",subtitle:"PRECIPITATION PROBABILITY",summary:summary(window(data.hourly.precipitation_probability),(value)=>`${Math.round(value)}%`),scale:scaleDomain(window(data.hourly.precipitation_probability),{fixed:[0,100]}),kind:"percent",labels,series:[{name:"Rain chance",color:"#39c5cf",points:toPoints(window(data.hourly.precipitation_probability))}]}),
        publishedChart({title:"Rainfall",subtitle:"PRECIPITATION · MM",scale:scaleDomain(window(data.hourly.precipitation),{zero:true}),kind:"mm",labels,bars:barsFor(window(data.hourly.precipitation),scaleDomain(window(data.hourly.precipitation),{zero:true})).map((bar)=>({...bar,color:rainTint(bar.value)}))}),
        publishedChart({title:"Wind",subtitle:"SPEED AND GUSTS",scale:scaleDomain([...window(data.hourly.wind_speed_10m),...window(data.hourly.wind_gusts_10m)],{zero:true}),kind:"speed",unit:speed,labels,series:[{name:"Wind",color:"#3fb950",points:toPoints(window(data.hourly.wind_speed_10m))},{name:"Gusts",color:"#8f7cff",points:toPoints(window(data.hourly.wind_gusts_10m))}]}),
        publishedChart({title:"Humidity",subtitle:"RELATIVE HUMIDITY",scale:scaleDomain(window(data.hourly.relative_humidity_2m),{fixed:[0,100]}),kind:"percent",labels,series:[{name:"Humidity",color:"#57b6c9",points:toPoints(window(data.hourly.relative_humidity_2m))}]}),
        publishedChart({title:"UV index",subtitle:"ULTRAVIOLET · MAX PER HOUR",scale:scaleDomain(window(data.hourly.uv_index),{zero:true}),kind:"speed",labels,series:[{name:"UV index",color:"#ffb547",points:toPoints(window(data.hourly.uv_index))}]})
      ];
      const mmScale=scaleDomain(data.daily.precipitation_sum,{zero:true});
      const rainScale=scaleDomain(data.daily.precipitation_probability_max,{fixed:[0,100]});
      const daily=[
        publishedRangeChart(data.daily.time.map((date,index)=>({date,max:data.daily.temperature_2m_max[index],min:data.daily.temperature_2m_min[index]})),scaleDomain([...data.daily.temperature_2m_max,...data.daily.temperature_2m_min]),dailyLabels,unit),
        publishedChart({title:"Daily rain chance",subtitle:"7-DAY PROBABILITY",scale:rainScale,kind:"percent",labels:dailyLabels,bars:barsFor(data.daily.precipitation_probability_max,rainScale).map((bar)=>({...bar,color:bar.value>0?"#39c5cf":"#2c3a44"}))}),
        publishedChart({title:"Daily wind",subtitle:"MAX SPEED AND GUSTS",scale:scaleDomain([...data.daily.wind_speed_10m_max,...data.daily.wind_gusts_10m_max],{zero:true}),kind:"speed",unit:speed,labels:dailyLabels,series:[{name:"Max wind",color:"#3fb950",points:toPoints(data.daily.wind_speed_10m_max)},{name:"Max gust",color:"#8f7cff",points:toPoints(data.daily.wind_gusts_10m_max)}]}),
        publishedChart({title:"Total rainfall",subtitle:"DAILY MM",scale:mmScale,kind:"mm",labels:dailyLabels,bars:barsFor(data.daily.precipitation_sum,mmScale).map((bar)=>({...bar,color:rainTint(bar.value)}))})
      ];
      return page(dashboard,`<header><div><label>LIVE WEATHER</label><h1>${escapeHtml(config.location)}</h1><p>${config.latitude.toFixed(2)}°, ${config.longitude.toFixed(2)}° · ${escapeHtml(data.timezone_abbreviation??"")}</p></div><span>OPEN-METEO</span></header>
<section class="wp-top"><article class="card wp-now"><div class="wp-symbol">${weatherSymbol(data.current.weather_code)}</div><div><p>${escapeHtml(describeWeather(data.current.weather_code,"Current conditions"))}</p><strong>${Math.round(data.current.temperature_2m)}<sup>${escapeHtml(unit)}</sup></strong></div><dl>${detail.map(([label,value])=>`<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></article>
<article class="card wp-sun"><label>SUN &amp; DAYLIGHT<b>Today at a glance</b></label><div class="wp-arc"><svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label="Sunrise to sunset arc"><path class="wp-arc-horizon" d="M2 46 H98"/><path class="wp-arc-path" d="M4 46 A 46 40 0 0 1 96 46"/>${arc}</svg><div class="wp-arc-ends"><span>SUNRISE<b>${stamp(sun)}</b></span><span class="wp-arc-mid">Daylight ${Math.round(progress*100)}%</span><span>SUNSET<b>${stamp(set)}</b></span></div></div><ul class="wp-sun-facts"><li><dt>Rain today</dt><dd>${data.daily.precipitation_sum[0]} mm</dd></li><li><dt>UV index</dt><dd>${Math.round(data.daily.uv_index_max[0])}</dd></li><li><dt>Max wind</dt><dd>${Math.round(data.daily.wind_speed_10m_max[0])} ${escapeHtml(speed)}</dd></li><li><dt>Gusts</dt><dd>${Math.round(data.daily.wind_gusts_10m_max[0])} ${escapeHtml(speed)}</dd></li></ul></article></section>
<section class="wp-week">${data.daily.time.map((date,index)=>`<article class="card wp-day"><label>${escapeHtml(dayName(date,index))}</label><span class="wp-day-symbol">${weatherSymbol(data.daily.weather_code[index])}</span><p>${escapeHtml(describeWeather(data.daily.weather_code[index]))}</p><dl><div><dt>Rain</dt><dd>${data.daily.precipitation_probability_max[index]}%</dd></div><div><dt>mm</dt><dd>${data.daily.precipitation_sum[index]}</dd></div></dl><strong>${Math.round(data.daily.temperature_2m_max[index])}°<small>${Math.round(data.daily.temperature_2m_min[index])}°</small></strong></article>`).join("")}</section>
<section class="wp-section-head">METRIC DETAIL<em>Next 48 hours</em></section><section class="wp-charts">${charts.join("")}</section>
<section class="wp-section-head">DAILY OUTLOOK<em>Highs, lows and rain</em></section><section class="wp-charts">${daily.join("")}</section>`);
    }catch{return page(dashboard,`<header><div><label>LIVE WEATHER</label><h1>${escapeHtml(config.location)}</h1></div></header><main><article class="card" style="grid-column:span 12"><h2>Forecast temporarily unavailable</h2><p>Refresh this page to try again.</p></article></main>`);}
  }
  return page(dashboard, `<header><div><label>DASHBOARD / ${escapeHtml(dashboard.id)}</label><h1>${escapeHtml(dashboard.title)}</h1><p>${escapeHtml(dashboard.description)}</p></div><span>REV ${dashboard.revision}</span></header><main>${(await Promise.all(dashboard.widgets.map((widget) => widget.type === "prometheus" ? renderPrometheusWidget(widget) : renderWidget(widget)))).join("")}</main>`);
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.get("/api/health", async (_request, response) => {
    try {
      await fs.access(dataDir, fsConstants.W_OK);
      response.json({ status: "ok", store: "writable" });
    } catch {
      response.status(503).json({ status: "degraded", store: "data directory is not writable", dataDir });
    }
  });
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
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error);
    const code = (error as NodeJS.ErrnoException)?.code;
    const permissions = code === "EACCES" || code === "EPERM" || code === "EROFS";
    response.status(500).json({
      error: permissions
        ? `The data directory ${dataDir} is not writable by uid ${process.getuid?.() ?? 1000}. Chown it to that user.`
        : "The dashboard store is temporarily unavailable"
    });
  });
  return app;
}

if (process.env.NODE_ENV !== "test") createApp().listen(Number(process.env.PORT ?? 8787), "0.0.0.0", () => console.log("Stratum API listening on http://localhost:8787"));
