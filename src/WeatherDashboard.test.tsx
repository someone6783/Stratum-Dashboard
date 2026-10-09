// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WeatherDashboard } from "./WeatherDashboard";
import { weatherDashboard } from "../shared/dashboard";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("weather dashboard", () => {
  it("renders current and forecast data returned by Open-Meteo", async () => {
    const hours=Array.from({length:24},(_,index)=>`2026-10-09T${String(index).padStart(2,"0")}:00`);
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({
      timezone_abbreviation:"GMT+8",
      current:{time:"2026-10-09T11:15",temperature_2m:16.7,apparent_temperature:15.2,relative_humidity_2m:66,precipitation:0,weather_code:2,wind_speed_10m:19,is_day:1},
      current_units:{temperature_2m:"°C",wind_speed_10m:"km/h",precipitation:"mm"},
      hourly:{time:hours,temperature_2m:hours.map((_,index)=>16+index/4),precipitation_probability:hours.map(()=>20),weather_code:hours.map(()=>2)},
      daily:{time:["2026-10-09","2026-10-10","2026-10-11","2026-10-12","2026-10-13","2026-10-14","2026-10-15"],weather_code:[2,61,63,1,0,2,80],temperature_2m_max:[17,19,18,21,25,28,22],temperature_2m_min:[14,15,12,9,12,15,16],sunrise:["2026-10-09T05:45"],sunset:["2026-10-09T18:21"],precipitation_probability_max:[73,75,47,0,0,6,35]}
    })}));
    render(<WeatherDashboard dashboard={weatherDashboard}/>);
    expect((await screen.findAllByText("Partly cloudy")).length).toBeGreaterThan(0);
    expect(screen.getByText((_,element)=>element?.textContent==="17°C")).toBeTruthy();
    expect(screen.getByText("The week ahead")).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
