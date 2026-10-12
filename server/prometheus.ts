import { parseDuration, type PromResult, type PromSeries } from "../shared/prometheus.js";

const MAX_RANGE_SECONDS = 30 * 86400;
const MIN_STEP_SECONDS = 15;
const DEFAULT_TIMEOUT_MS = 8000;

/** PromQL is passed through to Prometheus verbatim, so keep the character set tight. */
const SAFE_QUERY = /^[a-zA-Z0-9_:{},()"=+\-*/.%![\]<>~\s]+$/;

export type PrometheusOptions = {
  url?: string;
  token?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
};

type RawRange = { metric?: Record<string, string>; values?: [number | string, number | string][] };

export function createPrometheus(options: PrometheusOptions) {
  const url = options.url?.replace(/\/+$/, "");
  const cacheTtlMs = options.cacheTtlMs ?? 10_000;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cache = new Map<string, { expiresAt: number; result: PromResult }>();

  async function request<T>(path: string, params: Record<string, string>): Promise<T> {
    const target = new URL(`${url}${path}`);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    const response = await fetch(target, {
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`Prometheus responded with ${response.status}`);
    const payload = (await response.json()) as { status?: string; error?: string; errorType?: string; data?: T };
    if (payload.status !== "success") throw new Error(payload.error ?? "Prometheus rejected the query");
    return payload.data as T;
  }

  return {
    get configured() {
      return Boolean(url);
    },

    /** Runs a range query and normalises the Prometheus payload into the client contract. */
    async query(query: string, range = "6h", step = "1m"): Promise<PromResult> {
      if (!url) return { ok: false, query, series: [], value: null, stale: true, error: "Prometheus is not configured on this server" };
      if (!SAFE_QUERY.test(query)) return { ok: false, query, series: [], value: null, stale: true, error: "Query contains unsupported characters" };

      const rangeSeconds = Math.min(parseDuration(range, 21_600), MAX_RANGE_SECONDS);
      const stepSeconds = Math.max(parseDuration(step, 60), MIN_STEP_SECONDS);
      const end = Math.floor(Date.now() / 1000);
      const cacheKey = `${query}|${end - rangeSeconds}|${stepSeconds}`;
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.result;

      let result: PromResult;
      try {
        const raw = await request<{ resultType: string; result: RawRange[] }>("/api/v1/query_range", {
          query, step: String(stepSeconds), start: String(end - rangeSeconds), end: String(end)
        });
        const now = Date.now();
        const series: PromSeries[] = (raw.result ?? []).map((entry) => {
          const points = (entry.values ?? []).map(([time, value]) => [Number(time) * 1000, toNumber(value)] as [number, number | null]);
          const last = [...points].reverse().find(([, value]) => value !== null);
          return { labels: entry.metric ?? {}, points, stale: !last || now - last[0] > stepSeconds * 3000 };
        });
        const latest = series.flatMap((entry) => entry.points).filter(([, value]) => value !== null).sort((a, b) => b[0] - a[0])[0];
        result = {
          ok: true, query, series,
          value: latest ? latest[1] : null,
          stale: !latest || series.every((entry) => entry.stale)
        };
      } catch (error) {
        result = { ok: false, query, series: [], value: null, stale: true, error: error instanceof Error ? error.message : "Prometheus query failed" };
      }

      cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, result });
      if (cache.size > 500) cache.clear();
      return result;
    }
  };
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type PrometheusClient = ReturnType<typeof createPrometheus>;