import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Droplets, MapPin, Navigation, RefreshCw, Search, Snowflake, Sun, Sunrise, Sunset, Wind } from "lucide-react";
import type { Dashboard } from "../shared/dashboard";

type WeatherResponse = {
  timezone_abbreviation: string;
  current: { time:string; temperature_2m:number; apparent_temperature:number; relative_humidity_2m:number; precipitation:number; weather_code:number; wind_speed_10m:number; is_day:number };
  current_units: { temperature_2m:string; wind_speed_10m:string; precipitation:string };
  hourly: { time:string[]; temperature_2m:number[]; precipitation_probability:number[]; weather_code:number[] };
  daily: { time:string[]; weather_code:number[]; temperature_2m_max:number[]; temperature_2m_min:number[]; sunrise:string[]; sunset:string[]; precipitation_probability_max:number[] };
};

const descriptions: Record<number,string> = { 0:"Clear sky",1:"Mostly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Rime fog",51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",71:"Light snow",73:"Snow",75:"Heavy snow",77:"Snow grains",80:"Rain showers",81:"Rain showers",82:"Heavy showers",85:"Snow showers",86:"Heavy snow showers",95:"Thunderstorm",96:"Storm with hail",99:"Severe storm" };

function WeatherGlyph({code,size=28,day=true}:{code:number;size?:number;day?:boolean}) {
  const props={size,strokeWidth:1.65,"aria-hidden":true};
  if(code===0) return <Sun {...props}/>;
  if(code<=2) return day?<CloudSun {...props}/>:<Cloud {...props}/>;
  if(code===3) return <Cloud {...props}/>;
  if(code===45||code===48) return <CloudFog {...props}/>;
  if(code>=71&&code<=77||code>=85&&code<=86) return <Snowflake {...props}/>;
  if(code>=95) return <CloudLightning {...props}/>;
  return <CloudRain {...props}/>;
}

const dayLabel=(value:string,index:number)=>index===0?"Today":new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{weekday:"short"});
const timeLabel=(value:string)=>new Date(value).toLocaleTimeString(undefined,{hour:"numeric"});

export function WeatherDashboard({dashboard}:{dashboard:Dashboard}) {
  const base=dashboard.weather!;
  const [place,setPlace]=useState(base); const [query,setQuery]=useState(""); const [data,setData]=useState<WeatherResponse>();
  const [error,setError]=useState<string>(); const [loading,setLoading]=useState(true); const [updated,setUpdated]=useState<Date>();
  const load=useCallback(async()=>{
    setLoading(true); setError(undefined);
    const params=new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),current:"temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day",hourly:"temperature_2m,precipitation_probability,weather_code",daily:"weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max",timezone:"auto",forecast_days:"7",temperature_unit:place.temperatureUnit});
    try { const response=await fetch(`https://api.open-meteo.com/v1/forecast?${params}`,{signal:AbortSignal.timeout(10_000)}); if(!response.ok) throw new Error("Forecast service returned an error"); setData(await response.json()); setUpdated(new Date()); }
    catch(reason){setError(reason instanceof Error?reason.message:"Weather data is unavailable");}
    finally{setLoading(false);}
  },[place]);
  useEffect(()=>{void load()},[load]);
  const findLocation=async(event:FormEvent)=>{event.preventDefault();if(query.trim().length<2)return;setLoading(true);setError(undefined);try{const response=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=1&language=en&format=json`,{signal:AbortSignal.timeout(10_000)});const result=await response.json();const match=result.results?.[0];if(!match)throw new Error("No matching location found");setPlace({...place,location:[match.name,match.admin1,match.country_code].filter(Boolean).join(", "),latitude:match.latitude,longitude:match.longitude});setQuery("");}catch(reason){setError(reason instanceof Error?reason.message:"Location search failed");setLoading(false);}};
  const currentHour=useMemo(()=>data?Math.max(0,data.hourly.time.findIndex((time)=>time>=data.current.time)):0,[data]);
  if(!data&&loading)return <div className="weather-state"><RefreshCw className="spin"/><p>Loading live forecast for {place.location}…</p></div>;
  if(!data)return <div className="weather-state"><CloudRain/><h2>Forecast unavailable</h2><p>{error}</p><button onClick={load}>Try again</button></div>;
  const unit=data.current_units.temperature_2m;
  return <section className="weather-workspace">
    <header className="weather-topbar"><div><p className="weather-kicker">LIVE FORECAST</p><h1>{place.location}</h1><p><MapPin size={13}/>{place.latitude.toFixed(2)}°, {place.longitude.toFixed(2)}° · {data.timezone_abbreviation}</p></div><div className="weather-tools"><form onSubmit={findLocation}><Search size={16}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Change location" aria-label="Search location"/></form><button onClick={load} title="Refresh forecast"><RefreshCw size={17}/><span>{loading?"Refreshing":"Refresh"}</span></button></div></header>
    {error&&<div className="weather-warning">Latest refresh failed. Showing the most recent forecast.</div>}
    <div className="weather-grid">
      <article className="weather-now"><div className="weather-orbit"><WeatherGlyph code={data.current.weather_code} size={92} day={Boolean(data.current.is_day)}/></div><div className="weather-current-copy"><p>{descriptions[data.current.weather_code]??"Current conditions"}</p><strong>{Math.round(data.current.temperature_2m)}<sup>{unit}</sup></strong><span>Feels like {Math.round(data.current.apparent_temperature)}{unit}</span></div><div className="weather-facts"><div><Droplets/><span>Humidity</span><b>{data.current.relative_humidity_2m}%</b></div><div><Wind/><span>Wind</span><b>{Math.round(data.current.wind_speed_10m)} {data.current_units.wind_speed_10m}</b></div><div><CloudRain/><span>Rain</span><b>{data.current.precipitation} {data.current_units.precipitation}</b></div></div></article>
      <article className="weather-hourly"><div className="weather-card-head"><div><p>NEXT 12 HOURS</p><h2>Through the day</h2></div><span>{updated?`Updated ${updated.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}`:"Live"}</span></div><div className="hour-strip">{data.hourly.time.slice(currentHour,currentHour+12).map((time,index)=>{const at=currentHour+index;return <div className={index===0?"current":""} key={time}><time>{index===0?"Now":timeLabel(time)}</time><WeatherGlyph code={data.hourly.weather_code[at]} size={25}/><b>{Math.round(data.hourly.temperature_2m[at])}°</b><small>{data.hourly.precipitation_probability[at]}%</small></div>})}</div></article>
      <article className="weather-week"><div className="weather-card-head"><div><p>7-DAY OUTLOOK</p><h2>The week ahead</h2></div><Navigation size={18}/></div><div className="week-list">{data.daily.time.map((date,index)=><div key={date}><b>{dayLabel(date,index)}</b><span className="condition"><WeatherGlyph code={data.daily.weather_code[index]} size={24}/>{descriptions[data.daily.weather_code[index]]??"Mixed"}</span><span className="rain"><Droplets size={14}/>{data.daily.precipitation_probability_max[index]}%</span><span className="temps"><strong>{Math.round(data.daily.temperature_2m_max[index])}°</strong><small>{Math.round(data.daily.temperature_2m_min[index])}°</small></span></div>)}</div></article>
      <aside className="weather-sun"><div><Sunrise/><span>Sunrise</span><b>{timeLabel(data.daily.sunrise[0])}</b></div><i/><div><Sunset/><span>Sunset</span><b>{timeLabel(data.daily.sunset[0])}</b></div><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Data by Open-Meteo</a></aside>
    </div>
  </section>;
}
