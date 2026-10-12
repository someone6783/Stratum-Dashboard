import { describe, expect, it } from "vitest";
import { dashboardSchema, defaultDashboard, weatherDashboard } from "./dashboard.js";

describe("dashboard contract", () => {
  it("accepts the bundled dashboard", () => expect(dashboardSchema.parse(defaultDashboard).id).toBe("overview"));
  it("accepts a coordinate-based live weather dashboard", () => expect(dashboardSchema.parse(weatherDashboard).weather?.location).toContain("Perth"));
  it("rejects executable ids and invalid widget spans", () => {
    expect(() => dashboardSchema.parse({ ...defaultDashboard, id: "../bad" })).toThrow();
    expect(() => dashboardSchema.parse({ ...defaultDashboard, widgets: [{ ...defaultDashboard.widgets[0], grid: { colSpan: 13 } }] })).toThrow();
  });
  it("ships a Prometheus-backed main dashboard with valid PromQL panels", () => {
    const prometheusPanels = defaultDashboard.widgets.filter((widget) => widget.type === "prometheus");
    expect(prometheusPanels.length).toBeGreaterThanOrEqual(8);
    for (const panel of prometheusPanels) {
      if (panel.type !== "prometheus") continue;
      expect(panel.query).toMatch(/^[a-zA-Z0-9_:{},()"=+\-*/.%!\[\]<>~\s]+$/);
      expect(panel.range).toMatch(/^\d+[smhdwy]$/);
      expect(panel.grid.colSpan).toBeGreaterThanOrEqual(1);
    }
  });
  it("rejects malformed Prometheus panel durations and empty queries", () => {
    const [panel] = defaultDashboard.widgets;
    expect(() => dashboardSchema.parse({ ...defaultDashboard, widgets: [{ ...panel, type: "prometheus", query: "sum(up)", range: "6 hours" }] })).toThrow();
    expect(() => dashboardSchema.parse({ ...defaultDashboard, widgets: [{ ...panel, type: "prometheus", query: "" }] })).toThrow();
  });
});
