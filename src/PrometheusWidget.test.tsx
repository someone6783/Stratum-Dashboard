// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { PrometheusWidgetPanel } from "./PrometheusWidget";
import { widgetSchema, type PrometheusWidget } from "../shared/dashboard";

const prometheusWidgetSchemaForTest = (widget: Record<string, unknown>) =>
  widgetSchema.parse({ type: "prometheus", ...widget }) as PrometheusWidget;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const now = Date.now();
const at = (offset: number) => (now - offset) / 1000;

describe("prometheus panels", () => {
  it("renders a metric panel from the proxied result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: true, query: "sum(up)", value: 4, stale: false, series: [{ labels: {}, stale: false, points: [[at(180), 3], [at(120), 4]] }] }) }));
    render(<PrometheusWidgetPanel widget={prometheusWidgetSchemaForTest({ id: "m", title: "Targets up", query: "sum(up)", format: "metric" })}/>);
    expect((await screen.findByText("4"))).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/prometheus/query?query=sum(up)"), expect.anything());
  });

  it("marks scrape health as a percentage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: true, stale: false, value: 87.75, series: [{ labels: {}, stale: false, points: [[at(60), 87.75]] }] }) }));
    const { container } = render(<PrometheusWidgetPanel widget={prometheusWidgetSchemaForTest({ id: "p", title: "Scrape health", query: "100 * avg(up)", format: "metric", unit: "percent" })}/>);
    expect(await screen.findByText("87.8")).toBeTruthy();
    expect(container.querySelector(".stat-value em")?.textContent).toBe("%");
  });

  it("appends a unit suffix so rates read like a monitoring UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: true, stale: false, value: 10_752, series: [{ labels: {}, stale: false, points: [[at(60), 10_752]] }] }) }));
    const { container } = render(<PrometheusWidgetPanel widget={prometheusWidgetSchemaForTest({ id: "s", title: "Upload speed", query: "rate(x[5m])", format: "metric", unit: "bytes", unitSuffix: "/s" })}/>);
    expect(await screen.findByText("10.5")).toBeTruthy();
    expect(container.querySelector(".stat-value em")?.textContent).toBe("KiB/s");
  });

  it("shows No data instead of an empty card when a query returns nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: true, stale: false, value: null, series: [] }) }));
    const { container } = render(<PrometheusWidgetPanel widget={prometheusWidgetSchemaForTest({ id: "nd", title: "S3 Errors / sec", query: "rate(y[5m])", format: "metric" })}/>);
    expect(await screen.findByText("No data")).toBeTruthy();
    expect(container.querySelector(".stat-spark")).toBeNull();
  });

  it("renders a targets list with per-target health", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({
      ok: true, stale: false, value: null,
      series: [
        { labels: { job: "postgres", instance: "db:9187" }, stale: false, points: [[at(60), 1]] },
        { labels: { job: "worker", instance: "worker:9001" }, stale: true, points: [[at(600), 0]] }
      ]
    }) }));
    render(<PrometheusWidgetPanel widget={prometheusWidgetSchemaForTest({ id: "t", title: "Target health", query: "up", format: "targets", labels: ["job", "instance"] })}/>);
    expect(await screen.findByText("1/2 up")).toBeTruthy();
    expect(screen.getByText(/worker · worker:9001/)).toBeTruthy();
    expect(document.querySelectorAll(".target-row .down-dot")).toHaveLength(1);
    expect(screen.getAllByText("db:9187").length).toBeGreaterThan(0);
  });

  it("renders one row per series in table format", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({
      ok: true, stale: false, value: null,
      series: [
        { labels: { job: "prometheus" }, stale: false, points: [[at(60), 84_762_624]] },
        { labels: { job: "postgres" }, stale: false, points: [[at(60), 18_317_312]] }
      ]
    }) }));
    render(<PrometheusWidgetPanel widget={prometheusWidgetSchemaForTest({ id: "tb", title: "Memory by job", query: "avg by (job) (process_resident_memory_bytes)", format: "table", unit: "bytes", labels: ["job"] })}/>);
    expect(await screen.findByText("prometheus")).toBeTruthy();
    expect(screen.getByText("postgres")).toBeTruthy();
    expect(screen.getByText("80.8")).toBeTruthy();
  });

  it("draws a chart path and legend once a window of samples arrives", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({
      ok: true, stale: false, value: 0.0313,
      series: [
        { labels: { slice: "queue_time" }, stale: false, points: [[at(180), 0.001], [at(120), 0.002], [at(60), 0.003]] },
        { labels: { slice: "inner_eval" }, stale: false, points: [[at(180), 0.002], [at(120), 0.004], [at(60), 0.006]] }
      ]
    }) }));
    const { container } = render(<PrometheusWidgetPanel widget={prometheusWidgetSchemaForTest({ id: "c", title: "Query latency p50", query: "prometheus_engine_query_duration_seconds{quantile=\"0.5\"}", format: "chart", unit: "seconds", labels: ["slice"] })}/>);
    await waitFor(() => expect(container.querySelectorAll("svg path.ts-line")).toHaveLength(2));
    expect(screen.getByText("queue_time")).toBeTruthy();
    expect(container.querySelector("svg path.ts-line")?.getAttribute("d")).toMatch(/^M0\.00/);
    expect(container.querySelectorAll(".ts-yaxis span").length).toBeGreaterThan(1);
    expect(container.querySelectorAll(".ts-xaxis span")).toHaveLength(5);
    expect(container.querySelectorAll(".ts-legend span")).toHaveLength(2);
  });

  it("explains an unconfigured datasource instead of showing a blank panel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: false, query: "sum(up)", series: [], value: null, stale: true, error: "Prometheus is not configured on this server" }) }));
    render(<PrometheusWidgetPanel widget={prometheusWidgetSchemaForTest({ id: "u", title: "Targets up", query: "sum(up)", format: "metric" })}/>);
    expect(await screen.findByText(/Prometheus is not configured/)).toBeTruthy();
  });

  it("surfaces query errors from the proxy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: false, query: "sum(", series: [], value: null, stale: true, error: "parse error: unexpected end of input" }) }));
    const { container } = render(<PrometheusWidgetPanel widget={prometheusWidgetSchemaForTest({ id: "e", title: "Query rate", query: "sum(", format: "chart" })}/>);
    expect(await screen.findByText(/parse error/)).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });
});