/** Shared Prometheus helpers: response shape, duration parsing, and value formatting. */

export type PromUnit = "number" | "bytes" | "percent" | "seconds" | "duration" | "text";
export type PromFormat = "metric" | "chart" | "table" | "targets";
export type PromPoint = [number, number | null];

export type PromSeries = {
  labels: Record<string, string>;
  points: PromPoint[];
  stale: boolean;
};

export type PromResult = {
  ok: boolean;
  query: string;
  series: PromSeries[];
  value: number | null;
  stale: boolean;
  error?: string;
};

const DURATION_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/** Parses PromQL-style durations ("30s", "6h", "2d") into seconds, falling back when invalid. */
export function parseDuration(value: string | undefined, fallback: number): number {
  const match = /^(\d+(?:\.\d+)?)([smhdwy])$/.exec((value ?? "").trim());
  if (!match) return fallback;
  const seconds = Number(match[1]) * DURATION_SECONDS[match[2]];
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
}

function decimalPlaces(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude >= 100) return 0;
  if (magnitude >= 10) return 1;
  if (magnitude >= 1) return 2;
  return 3;
}

/** Formats a plain number, compacting large magnitudes so metric cards stay readable. */
export function compactNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (magnitude >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimalPlaces(value) }).format(value);
}

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

export function formatBytes(value: number): { text: string; suffix: string } {
  const magnitude = Math.abs(value);
  const exponent = Math.min(Math.floor(Math.log(magnitude || 1) / Math.log(1024)), BYTE_UNITS.length - 1);
  const scaled = value / Math.pow(1024, exponent);
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return { text: scaled.toFixed(digits), suffix: BYTE_UNITS[exponent] };
}

/** Formats a seconds value the way Prometheus panels do: 186ms, 1.20s, 4.5m. */
export function formatSeconds(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0s";
  if (magnitude < 1) return `${(value * 1000).toFixed(magnitude < 0.01 ? 2 : 0)}ms`;
  if (magnitude < 60) return `${value.toFixed(2)}s`;
  if (magnitude < 3600) return `${(value / 60).toFixed(1)}m`;
  return `${(value / 3600).toFixed(1)}h`;
}

/** Formats a seconds value as a coarse duration string, e.g. "2h 14m 03s". */
export function formatDuration(value: number): string {
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (part: number) => String(part).padStart(2, "0");
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

export function formatValue(value: number | null, unit: PromUnit): { text: string; suffix: string } {
  if (value === null || !Number.isFinite(value)) return { text: "—", suffix: "" };
  if (unit === "percent") return { text: value.toFixed(value >= 100 || Number.isInteger(value) ? 0 : 1), suffix: "%" };
  if (unit === "bytes") return formatBytes(value);
  if (unit === "seconds") return { text: formatSeconds(value), suffix: "" };
  if (unit === "duration") return { text: formatDuration(value), suffix: "" };
  if (unit === "text") return { text: String(value), suffix: "" };
  return { text: compactNumber(value), suffix: "" };
}

/** Builds a human label for a series from the label keys the widget asked for. */
export function seriesName(labels: Record<string, string>, keys?: string[]): string {
  const chosen = (keys ?? Object.keys(labels))
    .map((key) => labels[key])
    .filter((value): value is string => Boolean(value));
  return chosen.length > 0 ? chosen.join(" · ") : labels.__name__ ?? "series";
}

/** Latest non-null sample across every series, which is what metric cards display. */
export function latestValue(series: PromSeries[]): number | null {
  let latest: number | null = null;
  let latestTime = -Infinity;
  for (const entry of series) {
    for (const [time, value] of entry.points) {
      if (value !== null && time > latestTime) {
        latestTime = time;
        latest = value;
      }
    }
  }
  return latest;
}

/** Scales a series' numeric samples into 0..100 heights for the mini bar sparkline. */
export function toSparkline(points: PromPoint[]): number[] {
  const values = points.map(([, value]) => value).filter((value): value is number => value !== null);
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return points.map(([, value]) => {
    if (value === null) return 0;
    if (span === 0) return 50;
    return ((value - min) / span) * 100;
  });
}