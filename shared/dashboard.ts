import { z } from "zod";

const gridSchema = z.object({ colSpan: z.number().int().min(1).max(12).default(4) });

const metricWidget = z.object({
  id: z.string().min(1), type: z.literal("metric"), title: z.string(), value: z.string(),
  detail: z.string().optional(), accent: z.enum(["lime", "violet", "blue"]).default("lime"),
  trend: z.array(z.number().min(0).max(100)).optional(), grid: gridSchema.default({ colSpan: 3 })
});
const statusWidget = z.object({
  id: z.string().min(1), type: z.literal("status"), title: z.string(),
  items: z.array(z.object({ name: z.string(), status: z.string(), value: z.string().optional() })),
  grid: gridSchema.default({ colSpan: 6 })
});
const chartWidget = z.object({
  id: z.string().min(1), type: z.literal("chart"), title: z.string(), value: z.string().optional(),
  detail: z.string().optional(), labels: z.array(z.string()), values: z.array(z.number()),
  grid: gridSchema.default({ colSpan: 8 })
});
const linksWidget = z.object({
  id: z.string().min(1), type: z.literal("links"), title: z.string(),
  items: z.array(z.object({ label: z.string(), url: z.string().url(), hint: z.string().optional() })),
  grid: gridSchema.default({ colSpan: 4 })
});
const htmlWidget = z.object({
  id: z.string().min(1), type: z.literal("html"), title: z.string(), html: z.string().max(20_000),
  grid: gridSchema.default({ colSpan: 6 })
});
const embedWidget = z.object({
  id: z.string().min(1), type: z.literal("embed"), title: z.string(), url: z.string().url(),
  height: z.number().int().min(160).max(1200).default(360), grid: gridSchema.default({ colSpan: 12 })
});
const durationField = z.string().regex(/^\d+(\.\d+)?[smhdwy]$/, "Use a Prometheus duration such as 30s, 6h or 2d");
const prometheusWidget = z.object({
  id: z.string().min(1), type: z.literal("prometheus"), title: z.string().min(1).max(80),
  query: z.string().min(1).max(2000), format: z.enum(["metric", "chart", "table", "targets"]).default("metric"),
  unit: z.enum(["number", "bytes", "percent", "seconds", "duration", "text"]).default("number"),
  detail: z.string().max(160).optional(), accent: z.enum(["lime", "violet", "blue"]).default("lime").optional(),
  range: durationField.default("6h"), step: durationField.default("1m"),
  refreshMs: z.number().int().min(5000).max(3600000).optional(),
  labels: z.array(z.string().min(1).max(40)).max(8).optional(),
  grid: gridSchema.default({ colSpan: 3 })
});

export const widgetSchema = z.discriminatedUnion("type", [metricWidget, statusWidget, chartWidget, linksWidget, htmlWidget, embedWidget, prometheusWidget]);

export type PrometheusWidget = z.infer<typeof prometheusWidget>;

export const dashboardSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(80),
  description: z.string().max(240).optional(),
  mode: z.enum(["dashboard", "search", "weather"]),
  theme: z.object({ accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#b7f34a"), density: z.enum(["compact", "comfortable"]).default("compact") }).default({ accent: "#b7f34a", density: "compact" }),
  widgets: z.array(widgetSchema).max(40).default([]),
  search: z.object({
    provider: z.enum(["google", "duckduckgo", "bing"]).default("google"),
    placeholder: z.string().max(80).default("Search the web"),
    shortcuts: z.array(z.object({ label: z.string(), url: z.string().url() })).max(16).default([])
  }).optional(),
  weather: z.object({
    location: z.string().min(2).max(80),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    temperatureUnit: z.enum(["celsius", "fahrenheit"]).default("celsius")
  }).optional(),
  updatedAt: z.string().datetime().optional(), revision: z.number().int().nonnegative().default(0)
});

export type Dashboard = z.infer<typeof dashboardSchema>;
export type Widget = z.infer<typeof widgetSchema>;

/** Generic example dashboard. Uses only standard Prometheus/client metrics so it runs on any datasource. */
export const defaultDashboard: Dashboard = {
  schemaVersion: 1, id: "overview", title: "Overview", description: "Live Prometheus metrics for every monitored target", mode: "dashboard",
  theme: { accent: "#b7f34a", density: "compact" }, revision: 0,
  widgets: [
    { id: "targets-up", type: "prometheus", title: "Targets up", query: "sum(up)", format: "metric", unit: "number", detail: "scraping without error", accent: "lime", range: "6h", step: "1m", grid: { colSpan: 3 } },
    { id: "scrape-health", type: "prometheus", title: "Scrape health", query: "100 * avg(up)", format: "metric", unit: "percent", detail: "of configured targets", accent: "lime", range: "6h", step: "1m", grid: { colSpan: 3 } },
    { id: "query-rate", type: "prometheus", title: "Query rate", query: "sum(rate(prometheus_engine_query_duration_seconds_count[5m]))", format: "metric", unit: "number", detail: "queries per second", accent: "violet", range: "6h", step: "1m", grid: { colSpan: 3 } },
    { id: "tsdb-size", type: "prometheus", title: "TSDB on disk", query: "prometheus_tsdb_storage_blocks_bytes", format: "metric", unit: "bytes", detail: "persisted blocks", accent: "blue", range: "6h", step: "5m", grid: { colSpan: 3 } },
    { id: "query-latency", type: "prometheus", title: "Query latency p50 by slice", query: "prometheus_engine_query_duration_seconds{quantile=\"0.5\"}", format: "chart", unit: "seconds", detail: "per evaluation phase", labels: ["slice"], range: "6h", step: "1m", grid: { colSpan: 8 } },
    { id: "active-series", type: "prometheus", title: "Active series", query: "prometheus_tsdb_head_series", format: "metric", unit: "number", detail: "in the TSDB head", accent: "violet", range: "6h", step: "5m", grid: { colSpan: 4 } },
    { id: "target-list", type: "prometheus", title: "Target health", query: "up", format: "targets", unit: "number", labels: ["job", "instance"], range: "5m", step: "1m", grid: { colSpan: 4 } },
    { id: "job-memory", type: "prometheus", title: "Memory by job", query: "avg by (job) (process_resident_memory_bytes)", format: "table", unit: "bytes", labels: ["job"], range: "5m", step: "1m", grid: { colSpan: 4 } },
    { id: "job-cpu", type: "prometheus", title: "CPU by job", query: "sum by (job) (rate(process_cpu_seconds_total[5m]))", format: "table", unit: "number", detail: "cores in use", labels: ["job"], range: "5m", step: "1m", grid: { colSpan: 4 } },
    { id: "samples", type: "prometheus", title: "Samples ingested", query: "sum(rate(prometheus_engine_query_samples_total[5m]))", format: "chart", unit: "number", detail: "samples per second", range: "6h", step: "1m", grid: { colSpan: 8 } },
    { id: "http-rate", type: "prometheus", title: "HTTP request rate", query: "sum(rate(prometheus_http_requests_total[5m]))", format: "metric", unit: "number", detail: "requests per second", accent: "blue", range: "6h", step: "1m", grid: { colSpan: 4 } },
    { id: "note", type: "html", title: "Team note", html: "<strong>Prometheus-backed panels</strong><p>Every panel above is a PromQL query proxied by the Stratum API. Query endpoints and credentials stay in the server environment, never in the dashboard JSON.</p>", grid: { colSpan: 12 } }
  ]
};

export const searchDashboard: Dashboard = {
  schemaVersion: 1, id: "search-home", title: "Search home", mode: "search", revision: 0,
  theme: { accent: "#8f7cff", density: "comfortable" }, widgets: [],
  search: { provider: "google", placeholder: "Search the web or enter a URL", shortcuts: [
    { label: "GitHub", url: "https://github.com" }, { label: "Linear", url: "https://linear.app" },
    { label: "Cloudflare", url: "https://dash.cloudflare.com" }, { label: "Figma", url: "https://figma.com" }
  ] }
};

export const weatherDashboard: Dashboard = {
  schemaVersion: 1, id: "weather", title: "Weather", description: "Live local conditions and seven-day outlook", mode: "weather", revision: 0,
  theme: { accent: "#79d8ff", density: "compact" }, widgets: [],
  weather: { location: "Perth, Western Australia", latitude: -31.9523, longitude: 115.8613, temperatureUnit: "celsius" }
};
