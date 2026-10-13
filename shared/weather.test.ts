import { describe, expect, it } from "vitest";
import { areaPath, barsFor, dayName, GEOMETRY, linePath, rainTint, scaleDomain, timeAxis, toPoints, yPosition } from "./weather.js";

describe("weather chart scaling", () => {
  it("keeps percentage series on a fixed 0 to 100 axis", () => {
    const scale = scaleDomain(new Array(24).fill(0), { fixed: [0, 100] });
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(100);
    expect(scale.ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("snaps the domain outwards so the line fills the plot", () => {
    const values = Array.from({ length: 48 }, (_, index) => 12 + 7 * Math.sin((index / 24) * Math.PI * 2 - 1));
    const scale = scaleDomain(values);
    expect(scale.min).toBeLessThanOrEqual(Math.min(...values));
    expect(scale.max).toBeGreaterThanOrEqual(Math.max(...values));
    const used = Math.max(...values.map((value) => yPosition(value, scale))) - Math.min(...values.map((value) => yPosition(value, scale)));
    expect(used / GEOMETRY.height).toBeGreaterThan(0.7);
  });

  it("pads a flat series instead of collapsing onto one gridline", () => {
    const scale = scaleDomain(new Array(24).fill(16));
    expect(scale.max).toBeGreaterThan(scale.min);
    expect(scale.ticks.length).toBeGreaterThan(1);
  });

  it("anchors magnitudes at zero and survives an all-zero series", () => {
    expect(scaleDomain([4, 9], { zero: true }).min).toBe(0);
    const empty = scaleDomain(new Array(24).fill(0), { zero: true });
    expect(empty.min).toBe(0);
    expect(empty.max).toBeGreaterThan(0);
  });

  it("falls back to a unit domain when there is nothing to plot", () => {
    const scale = scaleDomain([]);
    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThan(scale.min);
  });
});

describe("weather chart geometry", () => {
  it("spaces samples evenly and keeps gaps out of the line", () => {
    const points = toPoints([1, null, 3]);
    expect(points.map((point) => point.x)).toEqual([0, 50, 100]);
    const path = linePath(points, { min: 0, max: 4, ticks: [] });
    expect(path.match(/M/g)).toHaveLength(2);
  });

  it("closes the area at the baseline", () => {
    const path = areaPath(toPoints([0, 4]), { min: 0, max: 4, ticks: [] });
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });

  it("centres bars in their slot so the first and last stay inside the plot", () => {
    const bars = barsFor([1, 2, 3], { min: 0, max: 3, ticks: [] });
    expect(bars[0].x).toBeGreaterThanOrEqual(0);
    expect(bars[2].x + bars[2].width).toBeLessThanOrEqual(GEOMETRY.width);
    const gaps = [bars[1].x - (bars[0].x + bars[0].width), bars[2].x - (bars[1].x + bars[1].width)];
    expect(gaps[0]).toBeCloseTo(gaps[1], 5);
  });

  it("gives zero-height bars a visible sliver and scales the rest to the domain", () => {
    const scale = scaleDomain([0, 0, 5], { zero: true });
    const bars = barsFor([0, 0, 5], scale);
    expect(bars[0].height).toBeGreaterThan(0);
    expect(bars[2].height).toBeGreaterThan(bars[0].height * 10);
  });
});

describe("weather chart axes", () => {
  it("does not repeat the closing label on a multi-day axis", () => {
    const times = Array.from({ length: 168 }, (_, index) => {
      const day = Math.floor(index / 24) + 13;
      return `2026-10-${String(day).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00`;
    });
    const labels = timeAxis(times, 7);
    expect(labels).toHaveLength(7);
    expect(labels[0].label).toMatch(/^Tue/);
    expect(labels[6].label).toMatch(/^Mon/);
  });

  it("closes an intraday axis on its final sample", () => {
    const times = Array.from({ length: 48 }, (_, index) => `2026-10-13T${String(index % 24).padStart(2, "0")}:00`);
    const labels = timeAxis(times, 8);
    expect(labels[labels.length - 1].index).toBe(47);
  });

  it("names the first day Today", () => {
    expect(dayName("2026-10-13", 0)).toBe("Today");
    expect(dayName("2026-10-14", 1)).not.toBe("Today");
  });
});

describe("rainfall tint", () => {
  it("darkens dry days and brightens heavy rain", () => {
    expect(rainTint(0)).toBe(rainTint(0));
    expect(rainTint(0)).not.toBe(rainTint(12));
    expect(rainTint(12)).not.toBe(rainTint(0.5));
  });
});