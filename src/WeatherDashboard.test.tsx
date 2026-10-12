// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WeatherDashboard } from "./WeatherDashboard";
import { weatherDashboard } from "../shared/dashboard";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const hours = Array.from({ length: 48 }, (_, index) => `2026-10-09T${String(index).padStart(2, "0")}:00`);
const days = ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"];

const stubForecast = () => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
  timezone_abbreviation: "GMT+8",
  current: {
    time: "2026-10-09T11:15", temperature_2m: 16.7, apparent_temperature: 15.2, relative_humidity_2m: 66,
    precipitation: 0, weather_code: 2, wind_speed_10m: 19, wind_direction_10m: 225, surface_pressure: 1014.2, is_day: 1
  },
  current_units: { temperature_2m: "°C", wind_speed_10m: "km/h", precipitation: "mm", wind_direction_10m: "°", surface_pressure: "hPa" },
  hourly: {
    time: hours, temperature_2m: hours.map((_, index) => 16 + index / 4),
    precipitation_probability: hours.map((_, index) => (index % 7) * 12), weather_code: hours.map(() => 2),
    apparent_temperature: hours.map((_, index) => 15 + index / 4), relative_humidity_2m: hours.map(() => 66),
    wind_speed_10m: hours.map((_, index) => 18 + (index % 5))
  },
  daily: {
    time: days, weather_code: [2, 61, 63, 1, 0, 2, 80],
    temperature_2m_max: [17, 19, 18, 21, 25, 28, 22], temperature_2m_min: [14, 15, 12, 9, 12, 15, 16],
    sunrise: days.map(() => "2026-10-09T05:45"), sunset: days.map(() => "2026-10-09T18:21"),
    precipitation_probability_max: [73, 75, 47, 0, 0, 6, 35], precipitation_sum: [4.2, 9.6, 2.1, 0, 0, 0.3, 1.8],
    wind_speed_10m_max: [22, 19, 24, 17, 15, 20, 26], wind_gusts_10m_max: [41, 36, 44, 30, 28, 35, 48],
    uv_index_max: [7.8, 6.1, 4.2, 8.4, 9.1, 8.8, 5.5]
  }
}) }));

describe("weather dashboard", () => {
  it("renders current and forecast data returned by Open-Meteo", async () => {
    stubForecast();
    const { container } = render(<WeatherDashboard dashboard={weatherDashboard}/>);
    expect((await screen.findAllByText("Partly cloudy")).length).toBeGreaterThan(0);
    expect(container.querySelector(".weather-current-copy strong")?.textContent).toBe("17°C");
    expect(screen.getByText("The week ahead")).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("shows pressure, today's range, and the wind compass bearing", async () => {
    stubForecast();
    render(<WeatherDashboard dashboard={weatherDashboard}/>);
    expect(await screen.findByText("Pressure")).toBeTruthy();
    expect(screen.getByText("1014 hPa")).toBeTruthy();
    expect(screen.getByText("Today's high")).toBeTruthy();
    expect(screen.getByText("Today's low")).toBeTruthy();
    expect(screen.getByText("19 km/h SW")).toBeTruthy();
  });

  it("adds daily totals for rain, UV, wind, and gusts", async () => {
    stubForecast();
    render(<WeatherDashboard dashboard={weatherDashboard}/>);
    expect(await screen.findByText("Rain today")).toBeTruthy();
    expect(screen.getByText("4.2 mm")).toBeTruthy();
    expect(screen.getByText("UV index")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("Gusts")).toBeTruthy();
    expect(screen.getByText("41 km/h")).toBeTruthy();
  });

  it("plots a 24 hour temperature chart with both air and apparent series", async () => {
    stubForecast();
    const { container } = render(<WeatherDashboard dashboard={weatherDashboard}/>);
    expect(await screen.findByText("TEMPERATURE")).toBeTruthy();
    const chart = container.querySelectorAll(".weather-chart")[0];
    expect(chart.querySelectorAll(".ts-line")).toHaveLength(2);
    expect(chart.querySelectorAll(".ts-grid").length).toBeGreaterThan(1);
    expect(chart.querySelector(".ts-xaxis span")?.textContent).toBeTruthy();
    expect(chart.querySelectorAll(".ts-legend span")).toHaveLength(2);
  });

  it("plots rain chance and wind speed charts", async () => {
    stubForecast();
    const { container } = render(<WeatherDashboard dashboard={weatherDashboard}/>);
    expect(await screen.findByText("RAIN CHANCE")).toBeTruthy();
    expect(screen.getByText("WIND SPEED")).toBeTruthy();
    const charts = container.querySelectorAll(".weather-chart");
    expect(charts.length).toBe(4);
    expect(charts[1].querySelectorAll(".ts-line")).toHaveLength(1);
    expect(charts[2].querySelectorAll(".ts-line")).toHaveLength(1);
  });

  it("draws a daily high/low range chart with a rainfall bar per day", async () => {
    stubForecast();
    const { container } = render(<WeatherDashboard dashboard={weatherDashboard}/>);
    expect(await screen.findByText("Highs, lows and rainfall")).toBeTruthy();
    expect(container.querySelectorAll(".range-bar")).toHaveLength(7);
    expect(container.querySelectorAll(".rain-bars span")).toHaveLength(7);
  });
});