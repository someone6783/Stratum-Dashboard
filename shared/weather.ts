/** Shared weather chart maths: scaling, plot geometry, and SVG path building.
 *  Both the React dashboard and the dependency-free published fast view render from here,
 *  so a chart looks identical whichever way it is loaded. */
import { axisTicks } from "./prometheus.js";

export type ChartGeometry = { width: number; height: number; top: number; bottom: number };

/** Plot box: a little headroom above the top gridline and a baseline at the bottom. */
export const GEOMETRY: ChartGeometry = { width: 100, height: 190, top: 10, bottom: 182 };

export type Scale = { min: number; max: number; ticks: number[] };

export type Point = { x: number; value: number | null };

export type ScaleOptions = {
  /** Locks the domain, e.g. percentages always run 0..100. */
  fixed?: [number, number];
  /** Anchors the domain at zero for magnitudes such as rainfall or wind. */
  zero?: boolean;
};

/** Chooses a readable y domain for a series.
 *  Flat and tightly clustered data is padded so the line still fills the plot instead of
 *  hugging one edge, percentage series keep a fixed 0..100 axis, and magnitudes start at zero. */
export function scaleDomain(values: (number | null | undefined)[], options: ScaleOptions = {}): Scale {
  const [fixedMin, fixedMax] = options.fixed ?? [];
  if (fixedMin !== undefined && fixedMax !== undefined) return { min: fixedMin, max: fixedMax, ticks: axisTicks(fixedMin, fixedMax) };
  const numbers = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (numbers.length === 0) return { min: 0, max: 1, ticks: axisTicks(0, 1) };
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  if (options.zero) {
    const ceiling = high > 4 ? Math.ceil(high) : Math.max(Number(high.toFixed(1)), 0.5);
    return { min: 0, max: ceiling, ticks: axisTicks(0, ceiling) };
  }
  if (low === high) {
    // A flat series still needs breathing room, otherwise the line sits on a single gridline.
    const pad = Math.max(Math.abs(low) * 0.1, 1);
    const min = niceFloor(low - pad), max = niceCeil(low + pad);
    return { min, max, ticks: axisTicks(min, max) };
  }
  // Snap outwards to the nearest 1/2/5 step so gridlines land on readable values
  // without the line floating in the middle of the plot.
  const step = niceStep((high - low) / 4);
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  return { min, max, ticks: axisTicks(min, max) };
}

/** Rounds up to the next 1/2/5/10 multiple, the spacing monitoring UIs use for gridlines. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const step = ([1, 2, 5, 10].reduce((best, candidate) => (Math.abs(candidate - normalized) < Math.abs(best - normalized) ? candidate : best))) * magnitude;
  return Number(step.toFixed(10));
}

function niceFloor(value: number): number {
  const step = niceStep(Math.max(Math.abs(value) * 0.1, 0.5) / 2);
  return Number((Math.floor(value / step) * step).toFixed(10));
}

function niceCeil(value: number): number {
  const step = niceStep(Math.max(Math.abs(value) * 0.1, 0.5) / 2);
  return Number((Math.ceil(value / step) * step).toFixed(10));
}

/** Vertical position of a value inside the plot box. */
export function yPosition(value: number, scale: Scale, geometry: ChartGeometry = GEOMETRY): number {
  const span = scale.max - scale.min || 1;
  return geometry.bottom - ((value - scale.min) / span) * (geometry.bottom - geometry.top);
}

/** Evenly spaces n samples across the plot width. */
export function scaleX(count: number, width: number = GEOMETRY.width): number[] {
  return Array.from({ length: count }, (_, index) => (count > 1 ? (index / (count - 1)) * width : width / 2));
}

/** Pairs values with evenly spaced x positions. */
export function toPoints(values: (number | null)[], width: number = GEOMETRY.width): Point[] {
  return scaleX(values.length, width).map((x, index) => ({ x, value: values[index] ?? null }));
}

/** Builds a polyline that breaks into new segments across gaps in the data. */
export function linePath(points: Point[], scale: Scale, geometry: ChartGeometry = GEOMETRY): string {
  let out = "";
  let open = false;
  for (const point of points) {
    if (point.value === null) { open = false; continue; }
    out += `${open ? "L" : "M"}${point.x.toFixed(2)} ${yPosition(point.value, scale, geometry).toFixed(2)} `;
    open = true;
  }
  return out.trim();
}

/** Fills the area between a series and the baseline. */
export function areaPath(points: Point[], scale: Scale, geometry: ChartGeometry = GEOMETRY): string {
  const usable = points.filter((point) => point.value !== null);
  if (usable.length < 2) return "";
  const top = usable.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${yPosition(point.value as number, scale, geometry).toFixed(2)}`).join(" ");
  return `${top} L${usable[usable.length - 1].x.toFixed(2)} ${geometry.bottom} L${usable[0].x.toFixed(2)} ${geometry.bottom} Z`;
}

export type Bar = { x: number; y: number; width: number; height: number; value: number };

/** Lays vertical bars out on the same x positions as a line series. */
export function barsFor(values: (number | null)[], scale: Scale, geometry: ChartGeometry = GEOMETRY, ratio = 0.55): Bar[] {
  const count = values.length;
  const slot = count ? geometry.width / count : geometry.width;
  const width = Math.max(slot * ratio, 0.6);
  const base = yPosition(Math.min(Math.max(0, scale.min), scale.max), scale, geometry);
  // Bars sit in the centre of their slot so the first and last stay inside the plot box.
  return values.map((value, index) => {
    const y = value === null ? base : yPosition(value, scale, geometry);
    return { x: index * slot + (slot - width) / 2, y: Math.min(y, base), width, height: Math.max(Math.abs(base - y), 0.8), value: value ?? 0 };
  });
}

/** Rain, drizzle, and snow thresholds in mm, used to colour precipitation bars. */
export function rainTint(mm: number): string {
  return mm >= 10 ? "#4a9eff" : mm >= 4 ? "#3d8bfd" : mm >= 1 ? "#39c5cf" : mm > 0 ? "#3fb950" : "#39414c";
}

export type AxisLabel = { index: number; label: string };

/** Picks evenly spaced time labels, switching to weekday names once the range spans days. */
export function timeAxis(times: string[], maxTicks = 7): AxisLabel[] {
  if (times.length === 0) return [];
  const spansDays = times.length > 1 && times[0].slice(0, 10) !== times[times.length - 1].slice(0, 10);
  const step = Math.max(1, Math.ceil(times.length / maxTicks));
  const labels: AxisLabel[] = [];
  for (let index = 0; index < times.length; index += step) labels.push({ index, label: formatTime(times[index], spansDays) });
  const last = times.length - 1;
  // Always close the axis on the final sample, unless that would collide with the last tick.
  const tail = labels[labels.length - 1].index;
  // Multi-day axes already end on a day boundary, so only intraday ranges need the closing tick.
  if (!spansDays && last - tail >= step / 2) labels.push({ index: last, label: formatTime(times[last], spansDays) });
  return labels;
}

/** "3 pm" for a single day, "Wed 3pm" once the axis covers several days. */
export function formatTime(value: string, withDay = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hour = date.toLocaleTimeString(undefined, { hour: "numeric" });
  if (!withDay) return hour;
  return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${hour}`;
}

/** Weekday label for a daily axis, using "Today" for the first column. */
export function dayName(value: string, index: number): string {
  if (index === 0) return "Today";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { weekday: "short" });
}

/** Formats a y axis tick for a given unit, dropping decimals that add no information. */
export function formatTick(value: number, kind: "temperature" | "percent" | "mm" | "plain" | "speed", unit = ""): string {
  if (kind === "percent") return `${Math.round(value)}%`;
  if (kind === "temperature") return `${Math.round(value)}°`;
  if (kind === "mm") return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}`;
  if (kind === "speed") return `${Math.round(value)}${unit ? ` ${unit}` : ""}`;
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

/** WMO weather interpretation codes used for the condition text beside each forecast. */
export const descriptions: Record<number, string> = {
  0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Rain showers", 81: "Rain showers",
  82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm", 96: "Storm with hail", 99: "Severe storm"
};

/** Human sentence for a weather code, with a fallback for codes outside the table. */
export function describeWeather(code: number, fallback = "Mixed"): string {
  return descriptions[code] ?? fallback;
}

/** Short x axis label for an hourly tick. */
export function hourTick(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString(undefined, { hour: "numeric" });
}