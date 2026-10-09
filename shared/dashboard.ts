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

export const widgetSchema = z.discriminatedUnion("type", [metricWidget, statusWidget, chartWidget, linksWidget, htmlWidget, embedWidget]);

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

export const defaultDashboard: Dashboard = {
  schemaVersion: 1, id: "overview", title: "Overview", description: "Operations at a glance", mode: "dashboard",
  theme: { accent: "#b7f34a", density: "compact" }, revision: 0,
  widgets: [
    { id: "sessions", type: "metric", title: "Active sessions", value: "2,847", detail: "+18.2% from last week", accent: "lime", trend: [25,42,36,61,56,82,72,94], grid: { colSpan: 3 } },
    { id: "response", type: "metric", title: "Avg. response", value: "186ms", detail: "24ms faster than target", accent: "violet", trend: [58,62,55,71,68,79,84,91], grid: { colSpan: 3 } },
    { id: "systems", type: "status", title: "System status", items: [{name:"Edge network",status:"Operational",value:"99.99%"},{name:"API cluster",status:"Operational",value:"99.97%"},{name:"Database",status:"Operational",value:"99.95%"}], grid: { colSpan: 6 } },
    { id: "requests", type: "chart", title: "Request volume", value: "1.24M", detail: "requests this month", labels: ["Nov","Jan","Mar","May","Jul","Sep"], values: [34,48,42,62,55,78,72,88,83,96,91,108], grid: { colSpan: 8 } },
    { id: "quick-links", type: "links", title: "Quick links", items: [{label:"GitHub",url:"https://github.com",hint:"github.com"},{label:"Cloudflare",url:"https://dash.cloudflare.com",hint:"dash.cloudflare.com"},{label:"Grafana",url:"https://grafana.com",hint:"metrics"},{label:"Linear",url:"https://linear.app",hint:"issues"}], grid: { colSpan: 4 } },
    { id: "note", type: "html", title: "Team note", html: "<strong>Release window</strong><p>Production rollout begins Friday at 14:00 UTC. All checks are currently green.</p>", grid: { colSpan: 12 } }
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
