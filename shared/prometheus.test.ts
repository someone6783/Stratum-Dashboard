import { describe, expect, it } from "vitest";
import { axisTicks, compactNumber, formatBytes, formatDuration, formatSeconds, formatValue, latestValue, parseDuration, presentValue, seriesName, toSparkline, type PromSeries } from "./prometheus.js";

const series = (values: (number | null)[]): PromSeries => ({ labels: {}, points: values.map((value, index) => [1_700_000_000_000 + index * 60_000, value]), stale: false });

describe("prometheus helpers", () => {
  it("parses PromQL durations and falls back on bad input", () => {
    expect(parseDuration("30s", 0)).toBe(30);
    expect(parseDuration("6h", 0)).toBe(21600);
    expect(parseDuration("2d", 0)).toBe(172800);
    expect(parseDuration("1.5h", 0)).toBe(5400);
    expect(parseDuration("nonsense", 42)).toBe(42);
    expect(parseDuration(undefined, 7)).toBe(7);
    expect(parseDuration("0s", 9)).toBe(9);
  });

  it("formats values according to the widget unit", () => {
    expect(formatValue(0.186, "seconds")).toEqual({ text: "186ms", suffix: "" });
    expect(formatValue(2.5, "seconds")).toEqual({ text: "2.50s", suffix: "" });
    expect(formatValue(0.0025, "seconds")).toEqual({ text: "2.50ms", suffix: "" });
    expect(formatValue(3000, "seconds")).toEqual({ text: "50.0m", suffix: "" });
    expect(formatValue(3725, "seconds")).toEqual({ text: "1.0h", suffix: "" });
    expect(formatValue(87.753, "percent")).toEqual({ text: "87.8", suffix: "%" });
    expect(formatValue(45_789_650, "bytes")).toEqual({ text: "43.7", suffix: "MiB" });
    expect(formatValue(8123, "duration")).toEqual({ text: "2h 15m 23s", suffix: "" });
    expect(formatValue(3936, "number")).toEqual({ text: "3,936", suffix: "" });
    expect(formatValue(84_800_000, "number")).toEqual({ text: "84.80M", suffix: "" });
    expect(formatValue(null, "number")).toEqual({ text: "—", suffix: "" });
    expect(formatValue(Number.NaN, "percent")).toEqual({ text: "—", suffix: "" });
  });

  it("formats bytes and durations without throwing on edge values", () => {
    expect(formatBytes(0)).toEqual({ text: "0.00", suffix: "B" });
    expect(formatSeconds(0)).toBe("0s");
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(65)).toBe("1m 05s");
    expect(compactNumber(1234.5678)).toBe("1,235");
    expect(compactNumber(12.3456)).toBe("12.3");
  });

  it("picks the newest non-null sample and names series from labels", () => {
    expect(latestValue([series([1, null, 7]), series([2, 9, null])])).toBe(7);
    expect(latestValue([])).toBeNull();
    expect(seriesName({ job: "postgres", instance: "db:9187" }, ["job"])).toBe("postgres");
    expect(seriesName({ job: "postgres", instance: "db:9187" })).toBe("postgres · db:9187");
    expect(seriesName({ __name__: "up" })).toBe("up");
  });

  it("scales sparkline points into 0..100 heights", () => {
    expect(toSparkline(series([0, 5, 10]).points)).toEqual([0, 50, 100]);
    expect(toSparkline(series([7, 7, 7]).points)).toEqual([50, 50, 50]);
    expect(toSparkline(series([null, 4]).points)).toEqual([0, 50]);
    expect(toSparkline([])).toEqual([]);
  });

  it("spaces axis ticks on 1/2/5 boundaries like a monitoring UI", () => {
    expect(axisTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(axisTicks(0, 9)).toEqual([0, 2, 4, 6, 8]);
    expect(axisTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(axisTicks(5, 5)).toEqual([5]);
    expect(axisTicks(Number.NaN, 10)).toEqual([Number.NaN]);
  });

  it("appends unit suffixes, keeping them tight against a base unit", () => {
    expect(presentValue(10_752, "bytes", "/s")).toEqual({ text: "10.5", suffix: "KiB/s" });
    expect(presentValue(2.07, "number", "/s")).toEqual({ text: "2.07", suffix: "/s" });
    expect(presentValue(45, "percent")).toEqual({ text: "45", suffix: "%" });
    expect(presentValue(null, "number", "/s")).toEqual({ text: "—", suffix: "/s" });
  });

  it("keeps byte formatting safe below one byte", () => {
    expect(formatBytes(0.0823)).toEqual({ text: "0.08", suffix: "B" });
    expect(formatBytes(0)).toEqual({ text: "0.00", suffix: "B" });
    expect(formatBytes(-2048)).toEqual({ text: "-2.00", suffix: "KiB" });
  });
});