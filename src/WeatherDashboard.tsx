import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Droplets, Eye, Gauge, MapPin, Navigation, RefreshCw, Search, Snowflake, Sun, Sunrise, Sunset, Thermometer, Umbrella, Wind } from "lucide-react";
import type { Dashboard } from "../shared/dashboard";
import { axisTicks } from "../shared/prometheus";

type WeatherResponse = {
  timezone_abbreviation: string;
  current: { time:string; temperature_2m:number; apparent_temperature:number; relative_humidity_2m:number; precipitation:number; weather_code:number; wind_speed_10m:number; wind_direction_10m:number; surface_pressure:number; is_day:number };
  current_units: { temperature_2m:string; wind_speed_10m:string; precipitation:string; wind_direction_10m:string; surface_pressure:string };
  hourly: { time:string[]; temperature_2m:number[]; precipitation_probability:number[]; weather_code:number[]; apparent_temperature:number[]; relative_humidity_2m:number[]; wind_speed_10m:number[] };
  daily: { time:string[]; weather_code:number[]; temperature_2m_max:number[]; temperature_2m_min:number[]; sunrise:string[]; sunset:string[]; precipitation_probability_max:number[]; precipitation_sum:number[]; wind_speed_10m_max:number[]; wind_gusts_10m_max:number[]; uv_index_max:number[] };
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

const COMPASS=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass=(degrees:number)=>COMPASS[Math.round(((degrees%360)+360)%360/22.5)%16];

/** Rain, drizzle, and snow thresholds in mm, used to colour the daily precipitation bars. */
const rainTint=(mm:number)=>mm>=10?"#4a9eff":mm>=4?"#3d8bfd":mm>=1?"#39c5cf":mm>0?"#3fb950":"#3a4048";

type ChartPoint = { x:number; value:number|null };

/** Positions values along the x axis; the chart owns vertical scaling. */
function buildSeries(values:(number|null)[], width=100):ChartPoint[] {
  return values.map((value,index)=>({ x:values.length>1?(index/(values.length-1))*width:width/2, value }));
}

/** Time series panel: value axis on the left, time along the bottom, dashed gridlines, legend beneath. */
function WeatherChart({title,subtitle,series,xLabels,format}:{title:string;subtitle:string;series:{name:string;color:string;points:ChartPoint[]}[];xLabels:string[];format:(value:number)=>string}) {
  const all=series.flatMap((entry)=>entry.points.map((point)=>point.value)).filter((value):value is number=>value!==null);
  const rawMin=all.length?Math.min(...all):0, rawMax=all.length?Math.max(...all):1;
  const min=all.every((value)=>value>=0)?0:rawMin, max=rawMax===min?min+Math.abs(min||1):rawMax, span=max-min||1;
  const yOf=(value:number)=>8+(180-((value-min)/span)*180);
  const steps=axisTicks(min,max);
  const path=(points:ChartPoint[])=>{
    let out="",open=false;
    for(const point of points){ if(point.value===null){open=false;continue;} out+=`${open?"L":"M"}${point.x.toFixed(2)} ${yOf(point.value).toFixed(2)}`; open=true; }
    return out;
  };
  const primary=series[0]?.points??[];
  const band=primary.length>1?`${primary.map((point,index)=>`${index===0?"M":"L"}${point.x.toFixed(2)} ${point.value===null?yOf(min):yOf(point.value).toFixed(2)}`).join(" ")} L${primary[primary.length-1].x.toFixed(2)} 188 L${primary[0].x.toFixed(2)} 188 Z`:null;
  return <article className="weather-chart">
    <div className="weather-card-head"><div><p>{subtitle}</p><h2>{title}</h2></div></div>
    <div className="ts-chart">
      <div className="ts-yaxis" style={{height:196}}>{steps.map((step)=><span key={step} style={{bottom:`${((step-min)/span)*100}%`}}>{format(step)}</span>)}</div>
      <div className="ts-main">
        <div className="ts-plot" style={{height:196}}>
          <svg viewBox="0 0 100 196" preserveAspectRatio="none" role="img" aria-label={`${subtitle.toLowerCase()} chart`}>
            {steps.map((step)=><line key={step} className="ts-grid" x1="0" y1={yOf(step)} x2="100" y2={yOf(step)}/>)}
            {band&&<path className="ts-band" style={{fill:series[0].color}} d={band}/>}
            {series.map((entry)=><path key={entry.name} className="ts-line" style={{stroke:entry.color}} d={path(entry.points)}/>)}
          </svg>
        </div>
        <div className="ts-xaxis">{xLabels.map((label,index)=><span key={index}>{label}</span>)}</div>
      </div>
    </div>
    <footer className="ts-legend">{series.map((entry)=><span key={entry.name}><i style={{background:entry.color}}/>{entry.name}</span>)}</footer>
  </article>;
}

/** Daily temperature range bars with highs, lows, and rainfall, spanning the whole week. */
function DailyRangeChart({days,unit,rainUnit}:{days:{date:string;max:number;min:number;rain:number;probability:number}[];unit:string;rainUnit:string}) {
  const highs=days.map((day)=>day.max), lows=days.map((day)=>day.min);
  const top=Math.max(...highs,1), bottom=Math.min(...lows,0), span=top-bottom||1;
  const largest=Math.max(...days.map((day)=>day.rain),0.0001);
  return <article className="weather-chart">
    <div className="weather-card-head"><div><p>7-DAY RANGE</p><h2>Highs, lows and rainfall</h2></div></div>
    <div className="ts-chart">
      <div className="ts-yaxis" style={{height:196}}>{axisTicks(bottom,top).map((step)=><span key={step} style={{bottom:`${((step-bottom)/span)*100}%`}}>{Math.round(step)}{unit}</span>)}</div>
      <div className="ts-main">
        <div className="ts-plot" style={{height:196}}>
          <svg viewBox="0 0 100 196" preserveAspectRatio="none" role="img" aria-label="Daily temperature range chart">
            {axisTicks(bottom,top).map((step)=>{const y=((step-bottom)/span)*180+8;return <line key={step} className="ts-grid" x1="0" y1={y} x2="100" y2={y}/>;})}
            {days.map((day,index)=>{
              const x=days.length>1?(index/(days.length-1))*100:50, width=100/days.length*0.34;
              const yMax=180-((day.max-bottom)/span)*180+8, yMin=180-((day.min-bottom)/span)*180+8;
              return <g key={day.date} className="range-bar"><rect x={x-width/2} y={yMax} width={width} height={Math.max(1,yMin-yMax)} rx={1}/><circle cx={x} cy={yMax} r={1.1} className="range-max"/><circle cx={x} cy={yMin} r={1.1} className="range-min"/></g>;
            })}
          </svg>
        </div>
        <div className="ts-xaxis">{days.map((day,index)=><span key={day.date}>{index===0?"Today":new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined,{weekday:"short"})}</span>)}</div>
      </div>
    </div>
    <footer className="rain-bars">{days.map((day)=><span key={day.date} title={`${day.rain} ${rainUnit} · ${day.probability}%`}><i style={{height:`${Math.max(3,(day.rain/largest)*34)}px`,background:rainTint(day.rain)}}/><em>{day.rain?`${day.rain}`:""}</em></span>)}</footer>
  </article>;
}

export function WeatherDashboard({dashboard}:{dashboard:Dashboard}) {
  const base=dashboard.weather!;
  const [place,setPlace]=useState(base); const [query,setQuery]=useState(""); const [data,setData]=useState<WeatherResponse>();
  const [error,setError]=useState<string>(); const [loading,setLoading]=useState(true); const [updated,setUpdated]=useState<Date>();
  const load=useCallback(async()=>{
    setLoading(true); setError(undefined);
    const params=new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),current:"temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,is_day",hourly:"temperature_2m,apparent_temperature,precipitation_probability,weather_code,relative_humidity_2m,wind_speed_10m",daily:"weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max",timezone:"auto",forecast_days:"7",temperature_unit:place.temperatureUnit});
    try { const response=await fetch(`https://api.open-meteo.com/v1/forecast?${params}`,{signal:AbortSignal.timeout(10_000)}); if(!response.ok) throw new Error("Forecast service returned an error"); setData(await response.json()); setUpdated(new Date()); }
    catch(reason){setError(reason instanceof Error?reason.message:"Weather data is unavailable");}
    finally{setLoading(false);}
  },[place]);
  useEffect(()=>{void load()},[load]);
  const findLocation=async(event:FormEvent)=>{event.preventDefault();if(query.trim().length<2)return;setLoading(true);setError(undefined);try{const response=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=1&language=en&format=json`,{signal:AbortSignal.timeout(10_000)});const result=await response.json();const match=result.results?.[0];if(!match)throw new Error("No matching location found");setPlace({...place,location:[match.name,match.admin1,match.country_code].filter(Boolean).join(", "),latitude:match.latitude,longitude:match.longitude});setQuery("");}catch(reason){setError(reason instanceof Error?reason.message:"Location search failed");setLoading(false);}};
  const currentHour=useMemo(()=>data?Math.max(0,data.hourly.time.findIndex((time)=>time>=data.current.time)):0,[data]);
  const todayIndex=useMemo(()=>data?Math.max(0,data.daily.time.findIndex((date)=>date===data.current.time.slice(0,10))):0,[data]);
  if(!data&&loading)return <div className="weather-state"><RefreshCw className="spin"/><p>Loading live forecast for {place.location}…</p></div>;
  if(!data)return <div className="weather-state"><CloudRain/><h2>Forecast unavailable</h2><p>{error}</p><button onClick={load}>Try again</button></div>;
  const unit=data.current_units.temperature_2m;
  return <section className="weather-workspace">
    <header className="weather-topbar"><div><p className="weather-kicker">LIVE FORECAST</p><h1>{place.location}</h1><p><MapPin size={13}/>{place.latitude.toFixed(2)}°, {place.longitude.toFixed(2)}° · {data.timezone_abbreviation}</p></div><div className="weather-tools"><form onSubmit={findLocation}><Search size={16}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Change location" aria-label="Search location"/></form><button onClick={load} title="Refresh forecast"><RefreshCw size={17}/><span>{loading?"Refreshing":"Refresh"}</span></button></div></header>
    {error&&<div className="weather-warning">Latest refresh failed. Showing the most recent forecast.</div>}
    <div className="weather-grid">
      <article className="weather-now"><div className="weather-orbit"><WeatherGlyph code={data.current.weather_code} size={92} day={Boolean(data.current.is_day)}/></div><div className="weather-current-copy"><p>{descriptions[data.current.weather_code]??"Current conditions"}</p><strong>{Math.round(data.current.temperature_2m)}<sup>{unit}</sup></strong><span>Feels like {Math.round(data.current.apparent_temperature)}{unit}</span></div><div className="weather-facts">
        <div><Droplets/><span>Humidity</span><b>{data.current.relative_humidity_2m}%</b></div>
        <div><Wind/><span>Wind</span><b>{Math.round(data.current.wind_speed_10m)} {data.current_units.wind_speed_10m} {compass(data.current.wind_direction_10m)}</b></div>
        <div><CloudRain/><span>Rain</span><b>{data.current.precipitation} {data.current_units.precipitation}</b></div>
        <div><Gauge/><span>Pressure</span><b>{Math.round(data.current.surface_pressure)} {data.current_units.surface_pressure}</b></div>
        <div><Thermometer/><span>Today's high</span><b>{Math.round(data.daily.temperature_2m_max[todayIndex])}{unit}</b></div>
        <div><Thermometer/><span>Today's low</span><b>{Math.round(data.daily.temperature_2m_min[todayIndex])}{unit}</b></div>
      </div></article>
      <article className="weather-hourly"><div className="weather-card-head"><div><p>NEXT 12 HOURS</p><h2>Through the day</h2></div><span>{updated?`Updated ${updated.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}`:"Live"}</span></div><div className="hour-strip">{data.hourly.time.slice(currentHour,currentHour+12).map((time,index)=>{const at=currentHour+index;return <div className={index===0?"current":""} key={time}><time>{index===0?"Now":timeLabel(time)}</time><WeatherGlyph code={data.hourly.weather_code[at]} size={25}/><b>{Math.round(data.hourly.temperature_2m[at])}°</b><small>{data.hourly.precipitation_probability[at]}%</small></div>})}</div></article>
      <article className="weather-week"><div className="weather-card-head"><div><p>7-DAY OUTLOOK</p><h2>The week ahead</h2></div><Navigation size={18}/></div><div className="week-list">{data.daily.time.map((date,index)=><div key={date}><b>{dayLabel(date,index)}</b><span className="condition"><WeatherGlyph code={data.daily.weather_code[index]} size={24}/>{descriptions[data.daily.weather_code[index]]??"Mixed"}</span><span className="rain"><Droplets size={14}/>{data.daily.precipitation_probability_max[index]}%</span><span className="temps"><strong>{Math.round(data.daily.temperature_2m_max[index])}°</strong><small>{Math.round(data.daily.temperature_2m_min[index])}°</small></span></div>)}</div></article>
      <aside className="weather-sun">
        <div><Sunrise/><span>Sunrise</span><b>{timeLabel(data.daily.sunrise[0])}</b></div><i/>
        <div><Sunset/><span>Sunset</span><b>{timeLabel(data.daily.sunset[0])}</b></div>
        <div><Umbrella/><span>Rain today</span><b>{data.daily.precipitation_sum[0]} mm</b></div>
        <div><Eye/><span>UV index</span><b>{Math.round(data.daily.uv_index_max[0])}</b></div>
        <div><Wind/><span>Max wind</span><b>{Math.round(data.daily.wind_speed_10m_max[0])} km/h</b></div>
        <div><Wind/><span>Gusts</span><b>{Math.round(data.daily.wind_gusts_10m_max[0])} km/h</b></div>
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Data by Open-Meteo</a>
      </aside>
    </div>
    <div className="weather-charts">
      <WeatherChart title="Next 24 hours" subtitle="TEMPERATURE" format={(value)=>`${Math.round(value)}${unit}`}
        xLabels={data.hourly.time.slice(currentHour,currentHour+24).filter((_,index)=>index%4===0).map((value)=>timeLabel(value))}
        series={[
          {name:"Air",color:"#3d8bfd",points:buildSeries(data.hourly.temperature_2m.slice(currentHour,currentHour+24))},
          {name:"Feels like",color:"#ff9f43",points:buildSeries(data.hourly.apparent_temperature.slice(currentHour,currentHour+24))}
        ]}/>
      <WeatherChart title="Next 24 hours" subtitle="RAIN CHANCE" format={(value)=>`${Math.round(value)}%`}
        xLabels={data.hourly.time.slice(currentHour,currentHour+24).filter((_,index)=>index%4===0).map((value)=>timeLabel(value))}
        series={[{name:"Precipitation probability",color:"#39c5cf",points:buildSeries(data.hourly.precipitation_probability.slice(currentHour,currentHour+24))}]}/>
      <WeatherChart title="Next 24 hours" subtitle="WIND SPEED" format={(value)=>`${Math.round(value)}`}
        xLabels={data.hourly.time.slice(currentHour,currentHour+24).filter((_,index)=>index%4===0).map((value)=>timeLabel(value))}
        series={[{name:"Wind",color:"#3fb950",points:buildSeries(data.hourly.wind_speed_10m.slice(currentHour,currentHour+24))}]}/>
      <DailyRangeChart unit={unit} rainUnit="mm" days={data.daily.time.map((date,index)=>({date,max:data.daily.temperature_2m_max[index],min:data.daily.temperature_2m_min[index],rain:data.daily.precipitation_sum[index],probability:data.daily.precipitation_probability_max[index]}))}/>
    </div>
  </section>;
}
