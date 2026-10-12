import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrometheus } from "./prometheus.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const rangeResponse = (result: unknown) => ({
  ok: true,
  json: async () => ({ status: "success", data: { resultType: "matrix", result } })
});

const series = (metric: Record<string, string>, values: [number, string][]) => ({ metric, values });

describe("prometheus proxy", () => {
  it("normalises a range query into the client contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(rangeResponse([series({ __name__: "up", job: "prometheus" }, [[1_700_000, "1"], [1_700_060, "1"]]) ]));
    vi.stubGlobal("fetch", fetchMock);
    const client = createPrometheus({ url: "http://prom.test:9090" });
    const result = await client.query("up", "1h", "1m");

    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);
    expect(result.series[0].labels.job).toBe("prometheus");
    expect(result.series[0].points[0]).toEqual([1_700_000_000, 1]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.pathname).toBe("/api/v1/query_range");
    expect(requested.searchParams.get("query")).toBe("up");
    expect(requested.searchParams.get("step")).toBe("60");
  });

  it("clamps the step and range to protect the datasource", async () => {
    const fetchMock = vi.fn().mockResolvedValue(rangeResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await createPrometheus({ url: "http://prom.test:9090" }).query("up", "365d", "1s");
    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(Number(requested.searchParams.get("step"))).toBe(15);
    expect(Number(requested.searchParams.get("start"))).toBeGreaterThan(0);
  });

  it("serves repeated queries from the short-lived cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(rangeResponse([series({ job: "prometheus" }, [[1_700_000, "1"]])]));
    vi.stubGlobal("fetch", fetchMock);
    const client = createPrometheus({ url: "http://prom.test:9090" });
    await client.query("up");
    await client.query("up");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("flags series whose samples stopped arriving", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rangeResponse([series({ job: "api" }, [[1_700_000, "1"]])])));
    const result = await createPrometheus({ url: "http://prom.test:9090" }).query("up");
    expect(result.stale).toBe(true);
  });

  it("reports datasource failures instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await createPrometheus({ url: "http://prom.test:9090" }).query("up");
    expect(result).toMatchObject({ ok: false, series: [], value: null });
    expect(result.error).toContain("503");
  });

  it("rejects queries with unexpected characters before hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await createPrometheus({ url: "http://prom.test:9090" }).query("up; curl evil.test");
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades gracefully when no datasource is configured", async () => {
    const client = createPrometheus({});
    expect(client.configured).toBe(false);
    const result = await client.query("up");
    expect(result).toMatchObject({ ok: false, series: [] });
    expect(result.error).toContain("not configured");
  });

  it("sends the bearer token when one is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(rangeResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await createPrometheus({ url: "http://prom.test:9090", token: "secret-token" }).query("up");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });
});