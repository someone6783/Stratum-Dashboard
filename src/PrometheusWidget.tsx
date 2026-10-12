import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, Radio } from "lucide-react";
import type { PrometheusWidget } from "../shared/dashboard";
import { axisTicks, formatValue, latestValue, presentValue, seriesName, type PromResult, type PromPoint, type PromSeries } from "../shared/prometheus";

const RANGE_CHOICES = ["1h", "6h", "24h", "7d"];
/** Monitoring-UI default series palette: blue, green, yellow, red, purple, cyan. */
export const SERIES_COLORS = ["#3d8bfd", "#3fb950", "#e3b341", "#f85149", "#a371f7", "#39c5cf"];
const PLOT_HEIGHT = 200;
const SPARK_HEIGHT = 44;

type Status = "loading" | "ready" | "error" | "unconfigured";

const failureText = (result: PromResult | undefined, status: Status) =>
  status === "error" ? (result?.error ?? "Query failed")
  : status === "unconfigured" ? "Prometheus is not configured on this server."
  : status === "loading" ? "Loading…"
  : "No data";

/** Polls the Stratum proxy for a PromQL result on the widget's refresh interval, pausing while the tab is hidden. */
function usePrometheus(widget: PrometheusWidget, range: string, step: string) {
  const [result, setResult] = useState<PromResult>();
  const [status, setStatus] = useState<Status>("loading");
  const [refreshedAt, setRefreshedAt] = useState<Date>();
  const active = useRef(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/prometheus/query?query=${encodeURIComponent(widget.query)}&range=${encodeURIComponent(range)}&step=${encodeURIComponent(step)}`, { signal });
      const payload = (await response.json()) as PromResult;
      if (!active.current) return;
      setResult(payload);
      setStatus(payload.error === "Prometheus is not configured on this server" ? "unconfigured" : payload.ok ? "ready" : "error");
      if (payload.ok) setRefreshedAt(new Date());
    } catch (reason) {
      if (!active.current || (reason instanceof DOMException && reason.name === "AbortError")) return;
      setStatus("error");
    }
  }, [widget.query, range, step]);

  const refreshMs = widget.refreshMs ?? 30_000;

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => { if (!document.hidden) void load(controller.signal); }, refreshMs);
    const onVisible = () => { if (!document.hidden) void load(controller.signal); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active.current = false; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, refreshMs]);

  return { result, status, refreshedAt };
}

/** Maps a series into 0..1 coordinates inside a viewBox, leaving headroom for the stroke. */
function toPath(points: PromPoint[], min: number, span: number, width: number, height: number) {
  return points.map(([, value], index) => {
    const x = points.length > 1 ? (index / (points.length - 1)) * width : width / 2;
    const y = height - (((value ?? min) - min) / span) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function boundsOf(series: PromSeries[]) {
  const values = series.flatMap((entry) => entry.points.map(([, value]) => value)).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = rawMin >= 0 ? 0 : rawMin;
  const max = rawMax === min ? min + Math.abs(min || 1) : rawMax;
  return { min, max, span: max - min };
}

function StatPanel({ widget, result, status, style }: { widget: PrometheusWidget; result?: PromResult; status: Status; style: CSSProperties }) {
  const healthy = status === "ready" && !result?.stale;
  const shown = presentValue(latestValue(result?.series ?? []), widget.unit, widget.unitSuffix);
  const points = result?.series[0]?.points ?? [];
  const bounds = boundsOf(result?.series ?? []);

  return <article className="panel stat-card" style={style}>
    <header className="panel-title"><span>{widget.title}</span>{widget.detail && healthy && <small>{widget.detail}</small>}</header>
    {healthy && shown.text !== "—" ? <>
      <div className="stat-value"><strong>{shown.text}</strong>{shown.suffix && <em>{shown.suffix}</em>}</div>
      <svg className="stat-spark" viewBox={`0 0 100 ${SPARK_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {bounds && <path className="spark-line" style={{ stroke: SERIES_COLORS[0] }} d={toPath(points, bounds.min, bounds.span, 100, SPARK_HEIGHT)}/>}
      </svg>
    </> : <div className="panel-state">{status === "error" && <AlertTriangle size={14}/>} {failureText(result, status)}</div>}
  </article>;
}

function TimeSeriesPanel({ widget, range, setRange, result, status, style }: { widget: PrometheusWidget; range: string; setRange: (value: string) => void; result?: PromResult; status: Status; style: CSSProperties }) {
  const series = (result?.series ?? []).slice(0, SERIES_COLORS.length);
  const bounds = boundsOf(series);
  const ticks = bounds ? axisTicks(bounds.min, bounds.max) : [];
  const shown = presentValue(latestValue(result?.series ?? []), widget.unit, widget.unitSuffix);
  const timestamps = series[0]?.points.map(([time]) => time) ?? [];

  const xLabels = useMemo(() => {
    if (timestamps.length === 0) return [];
    return Array.from({ length: 5 }, (_, index) => timestamps[Math.round((index * (timestamps.length - 1)) / 4)]);
  }, [timestamps]);

  const ready = status === "ready" && series.length > 0 && series[0].points.length > 1 && bounds;

  return <article className="panel ts-card" style={style}>
    <header className="panel-title">
      <span>{widget.title}</span>
      {ready && <select aria-label={`${widget.title} time range`} value={range} onChange={(event) => setRange(event.target.value)}>
        {RANGE_CHOICES.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
      </select>}
    </header>
    {ready ? <div className="ts-chart">
      <div className="ts-yaxis" style={{ height: PLOT_HEIGHT }}>
        {ticks.map((tick) => {
          const percent = ((tick - bounds.min) / bounds.span) * 100;
          const label = presentValue(tick, widget.unit, widget.unitSuffix);
          return <span key={tick} style={{ bottom: `${percent}%` }}>{label.text}{label.suffix && <em>{label.suffix}</em>}</span>;
        })}
      </div>
      <div className="ts-main">
        <div className="ts-plot" style={{ height: PLOT_HEIGHT }}>
          <svg viewBox={`0 0 100 ${PLOT_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${widget.title} chart`}>
            {ticks.map((tick) => {
              const y = PLOT_HEIGHT - ((tick - bounds.min) / bounds.span) * PLOT_HEIGHT;
              return <line key={tick} x1="0" y1={y} x2="100" y2={y} className="ts-grid"/>;
            })}
            {series.map((entry, index) => <path key={index} className="ts-line" style={{ stroke: SERIES_COLORS[index % SERIES_COLORS.length] }} d={toPath(entry.points, bounds.min, bounds.span, 100, PLOT_HEIGHT)}/>)}
          </svg>
        </div>
        <div className="ts-xaxis">{xLabels.map((time, index) => <span key={index}>{new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>)}</div>
      </div>
    </div> : <div className="panel-state panel-state-tall">{failureText(result, status)}</div>}
    {ready && <footer className="ts-legend">{series.map((entry, index) => <span key={index}><i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}/>{seriesName(entry.labels, widget.labels)}</span>)}</footer>}
    {!ready && shown.text !== "—" && status === "ready" && <p className="panel-note">{widget.detail}</p>}
  </article>;
}

function TablePanel({ widget, result, status, style }: { widget: PrometheusWidget; result?: PromResult; status: Status; style: CSSProperties }) {
  const series = result?.series ?? [];
  return <article className="panel table-card" style={style}>
    <header className="panel-title"><span>{widget.title}</span>{widget.detail && status === "ready" && <small>{widget.detail}</small>}</header>
    {status === "ready" && series.length > 0 ? <table className="metric-table">
      <tbody>{series.slice(0, 12).map((entry, index) => {
        const value = presentValue(latestValue([entry]), widget.unit, widget.unitSuffix);
        return <tr key={index}><td>{seriesName(entry.labels, widget.labels)}</td><td>{value.text}{value.suffix && <em>{value.suffix}</em>}</td></tr>;
      })}</tbody>
    </table> : <div className="panel-state">{failureText(result, status)}</div>}
  </article>;
}

function TargetsPanel({ widget, result, status, refreshedAt, style }: { widget: PrometheusWidget; result?: PromResult; status: Status; refreshedAt?: Date; style: CSSProperties }) {
  const series = result?.series ?? [];
  const up = series.filter((entry) => !entry.stale && latestValue([entry]) === 1).length;
  const degraded = status === "ready" && up < series.length;
  return <article className="panel targets-card" style={style}>
    <header className="panel-title"><span>{widget.title}</span><span className={`live ${degraded ? "warn" : ""}`}><Radio size={11}/> {status === "ready" ? `${up}/${series.length} up` : "SYNC"}</span></header>
    {series.slice(0, 12).map((entry, index) => {
      const healthy = !entry.stale && latestValue([entry]) === 1;
      return <div className="target-row" key={index}>
        <span className={healthy ? "ok-dot" : "down-dot"}/>
        <b>{seriesName(entry.labels, widget.labels)}</b>
        <em>{entry.labels.instance ?? ""}</em>
      </div>;
    })}
    {series.length === 0 && <div className="panel-state">{status === "error" && <AlertTriangle size={14}/>} {failureText(result, status)}</div>}
    {refreshedAt && <footer className="panel-foot">Updated {refreshedAt.toLocaleTimeString()}</footer>}
  </article>;
}

export function PrometheusWidgetPanel({ widget }: { widget: PrometheusWidget }) {
  const [range, setRange] = useState(widget.range);
  const { result, status, refreshedAt } = usePrometheus(widget, range, widget.step);
  const style = { "--span": widget.grid.colSpan } as CSSProperties;

  if (widget.format === "chart") return <TimeSeriesPanel widget={widget} range={range} setRange={setRange} result={result} status={status} style={style}/>;
  if (widget.format === "table") return <TablePanel widget={widget} result={result} status={status} style={style}/>;
  if (widget.format === "targets") return <TargetsPanel widget={widget} result={result} status={status} refreshedAt={refreshedAt} style={style}/>;
  return <StatPanel widget={widget} result={result} status={status} style={style}/>;
}