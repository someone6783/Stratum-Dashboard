import { describe, expect, it } from "vitest";
import { dashboardSchema, defaultDashboard, weatherDashboard } from "./dashboard.js";

describe("dashboard contract", () => {
  it("accepts the bundled dashboard", () => expect(dashboardSchema.parse(defaultDashboard).id).toBe("overview"));
  it("accepts a coordinate-based live weather dashboard", () => expect(dashboardSchema.parse(weatherDashboard).weather?.location).toContain("Perth"));
  it("rejects executable ids and invalid widget spans", () => {
    expect(() => dashboardSchema.parse({ ...defaultDashboard, id: "../bad" })).toThrow();
    expect(() => dashboardSchema.parse({ ...defaultDashboard, widgets: [{ ...defaultDashboard.widgets[0], grid: { colSpan: 13 } }] })).toThrow();
  });
});
