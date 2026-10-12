import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Activity, AlertTriangle, Radio } from "lucide-react";
import type { PrometheusWidget } from "../shared/dashboard";
import { formatValue, latestValue, seriesName, toSparkline, type PromResult, type PromSeries } from "../shared/prometheus";

const RANGE_CHOICES = ["1h", "6h", "24h", "7d"];
const SERIES_COLORS = ["var(--accent)", "#8f7cff", "#4aa8ff", "#ffb454", "#ff7a90", "#3ddc97"];
const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 180;

type Status = "loading" | "ready" | "error" | "unconfigured";

const failureText = (result: PromResult | undefined, status: Status) =>
  status === "error" ? (result?.error ?? "Query failed")
  : status === "unconfigured" ? "Prometheus is not configured on this server."
  : status === "loading" ? "Querying Prometheus…"
  : "No series returned.";

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

function MetricPanel({ widget, result, status, style }: { widget: PrometheusWidget; result?: PromResult; status: Status; style: CSSProperties }) {
  const formatted = formatValue(latestValue(result?.series ?? []), widget.unit);
  const spark = toSparkline(result?.series[0]?.points ?? []);
  const healthy = status === "ready" && !result?.stale;
  return <article className={`panel metric ${widget.accent ?? "lime"}`} style={style}>
    <div className="panel-label"><span>{widget.title}</span><Activity size={17}/></div>
    <strong className={healthy ? undefined : "value-pending"}>{formatted.text}{formatted.suffix && <span>{formatted.suffix}</span>}</strong>
    <p><b className={healthy ? undefined : "value-warning"}>{status === "ready" ? (healthy ? widget.detail ?? "Live" : "No recent samples") : failureText(result, status)}</b></p>
    {spark.length > 0 && <div className="mini-bars">{spark.slice(-24).map((height, index) => <i key={index} style={{ height: `${Math.max(4, height)}%` }}/>)}</div>}
  </article>;
}

function ChartPanel({ widget, range, setRange, result, status, style }: { widget: PrometheusWidget; range: string; setRange: (value: string) => void; result?: PromResult; status: Status; style: CSSProperties }) {
  const series = (result?.series ?? []).slice(0, SERIES_COLORS.length);
  const values = series.flatMap((entry) => entry.points.map(([, value]) => value)).filter((value): value is number => value !== null);
  const min = Math.min(...values, 0);
  const span = Math.max(...values, 0) - min || 1;
  const timestamps = series[0]?.points.map(([time]) => time) ?? [];
  const axis = useMemo(() => {
    if (timestamps.length === 0) return [];
    return Array.from({ length: 4 }, (_, index) => timestamps[Math.round((index * (timestamps.length - 1)) / 3)]);
  }, [timestamps]);

  const path = (entry: PromSeries) => entry.points.map(([time, value], index) => {
    const x = timestamps.length > 1 ? (index / (timestamps.length - 1)) * VIEW_WIDTH : VIEW_WIDTH / 2;
    const y = VIEW_HEIGHT - 12 - (((value ?? min) - min) / span) * (VIEW_HEIGHT - 30);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  const current = formatValue(latestValue(result?.series ?? []), widget.unit);
  const ready = status === "ready" && series.length > 0 && series[0].points.length > 1;

  return <article className="panel chart-card" style={style}>
    <div className="chart-head">
      <div>
        <div className="panel-label"><span>{widget.title}</span></div>
        <strong className={ready ? undefined : "value-pending"}>{current.text}{current.suffix && <span className="chart-suffix">{current.suffix}</span>}</strong>
        <small>{widget.detail}</small>
      </div>
      <select aria-label={`${widget.title} time range`} value={range} onChange={(event) => setRange(event.target.value)}>
        {RANGE_CHOICES.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
      </select>
    </div>
    {ready ? <>
      {series.length > 1 && <ul className="chart-legend">{series.map((entry, index) => <li key={index}><i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}/>{seriesName(entry.labels, widget.labels)}</li>)}</ul>}
      <div className="chart"><div className="grid-lines"/>
        <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${widget.title} chart`}>
          {series.map((entry, index) => <path key={index} className="line" style={{ stroke: SERIES_COLORS[index % SERIES_COLORS.length] }} d={path(entry)}/>)}
        </svg>
        <div className="axis">{axis.map((time, index) => <span key={index}>{new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>)}</div>
      </div>
    </> : <div className="chart-empty">{failureText(result, status)}</div>}
  </article>;
}

function TablePanel({ widget, result, status, style }: { widget: PrometheusWidget; result?: PromResult; status: Status; style: CSSProperties }) {
  const series = result?.series ?? [];
  return <article className="panel table-card" style={style}>
    <div className="panel-label"><span>{widget.title}</span>{status === "ready" && <span className="live">LIVE</span>}</div>
    {status === "ready" && series.length > 0 ? <table className="metric-table">
      <tbody>{series.slice(0, 12).map((entry, index) => {
        const value = formatValue(latestValue([entry]), widget.unit);
        return <tr key={index}><td>{seriesName(entry.labels, widget.labels)}</td><td>{value.text}{value.suffix && <span className="unit">{value.suffix}</span>}</td></tr>;
      })}</tbody>
    </table> : <div className="chart-empty">{failureText(result, status)}</div>}
  </article>;
}

function TargetsPanel({ widget, result, status, refreshedAt, style }: { widget: PrometheusWidget; result?: PromResult; status: Status; refreshedAt?: Date; style: CSSProperties }) {
  const series = result?.series ?? [];
  const up = series.filter((entry) => !entry.stale && latestValue([entry]) === 1).length;
  const degraded = status === "ready" && up < series.length;
  return <article className="panel system-card" style={style}>
    <div className="panel-label"><span>{widget.title}</span><span className={`live ${degraded ? "warn" : ""}`}><Radio size={11}/> {status === "ready" ? `${up}/${series.length} up` : "SYNC"}</span></div>
    {series.slice(0, 12).map((entry, index) => {
      const healthy = !entry.stale && latestValue([entry]) === 1;
      return <div className="system-row" key={index}>
        <span className={healthy ? "ok-dot" : "down-dot"}/>
        <div><b>{seriesName(entry.labels, widget.labels)}</b><small>{healthy ? "Up" : entry.stale ? "No recent samples" : "Down"}</small></div>
        <em>{entry.labels.instance ?? ""}</em>
      </div>;
    })}
    {series.length === 0 && <div className="chart-empty">{status === "error" && <AlertTriangle size={14}/>} {failureText(result, status)}</div>}
    {refreshedAt && <footer className="panel-foot">Updated {refreshedAt.toLocaleTimeString()}</footer>}
  </article>;
}

export function PrometheusWidgetPanel({ widget }: { widget: PrometheusWidget }) {
  const [range, setRange] = useState(widget.range);
  const { result, status, refreshedAt } = usePrometheus(widget, range, widget.step);
  const style = { "--span": widget.grid.colSpan } as CSSProperties;

  if (widget.format === "chart") return <ChartPanel widget={widget} range={range} setRange={setRange} result={result} status={status} style={style}/>;
  if (widget.format === "table") return <TablePanel widget={widget} result={result} status={status} style={style}/>;
  if (widget.format === "targets") return <TargetsPanel widget={widget} result={result} status={status} refreshedAt={refreshedAt} style={style}/>;
  return <MetricPanel widget={widget} result={result} status={status} style={style}/>;
}