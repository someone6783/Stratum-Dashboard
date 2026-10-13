import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Droplets, Eye, Gauge, MapPin, Navigation, RefreshCw, Search, Snowflake, Sun, Sunrise, Sunset, Thermometer, Umbrella, Wind } from "lucide-react";
import type { Dashboard } from "../shared/dashboard";
import { barsFor, areaPath, dayName, GEOMETRY, linePath, rainTint, scaleDomain, timeAxis, toPoints, yPosition, type AxisLabel, type Point, type Scale } from "../shared/weather";

type WeatherResponse = {
  timezone_abbreviation: string;
  current: { time:string; temperature_2m:number; apparent_temperature:number; relative_humidity_2m:number; precipitation:number; weather_code:number; wind_speed_10m:number; wind_direction_10m:number; surface_pressure:number; is_day:number };
  current_units: { temperature_2m:string; wind_speed_10m:string; precipitation:string; wind_direction_10m:string; surface_pressure:string };
  hourly: { time:string[]; temperature_2m:number[]; precipitation_probability:number[]; precipitation:number[]; weather_code:number[]; apparent_temperature:number[]; relative_humidity_2m:number[]; wind_speed_10m:number[]; wind_gusts_10m:number[]; uv_index:number[]; visibility:number[] };
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

const timeLabel=(value:string)=>new Date(value).toLocaleTimeString(undefined,{hour:"numeric"});

const COMPASS=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass=(degrees:number)=>COMPASS[Math.round(((degrees%360)+360)%360/22.5)%16];

/** Formats an hour count as "24 HOURS" / "3 DAYS" for the chart headings. */
const spanLabel=(hours:number)=>hours>=168?"7 DAYS":hours>=72?`${Math.round(hours/24)} DAYS`:`${hours} HOURS`;

type Series={name:string;color:string;points:Point[]};

/** Card shell shared by every chart: heading, value axis on the left, time along the bottom, legend beneath. */
function ChartCard({title,subtitle,summary,series,labels,scale,kind,unit,children,foot}:{title:string;subtitle:string;summary?:string;series?:Series[];labels?:AxisLabel[];scale:Scale;kind:"temperature"|"percent"|"mm"|"plain"|"speed";unit?:string;children:ReactNode;foot?:ReactNode}) {
  const format=(value:number)=>{
    if(kind==="percent")return `${Math.round(value)}%`;
    if(kind==="temperature")return `${Math.round(value)}°`;
    if(kind==="mm")return value>=10?value.toFixed(0):value.toFixed(1);
    if(kind==="speed")return unit?`${Math.round(value)} ${unit}`:`${Math.round(value)}`;
    return Number.isInteger(value)?`${value}`:value.toFixed(1);
  };
  return <article className="weather-chart">
    <div className="weather-card-head"><div><p>{subtitle}</p><h2>{title}</h2></div>{summary&&<span className="chart-summary">{summary}</span>}</div>
    <div className="ts-chart">
      <div className="ts-yaxis">{scale.ticks.map((tick)=><span key={tick} style={{bottom:`${(yPosition(tick,scale)/GEOMETRY.height)*100}%`}}>{format(tick)}</span>)}</div>
      <div className="ts-main">
        <div className="ts-plot">
          <svg viewBox={`0 0 ${GEOMETRY.width} ${GEOMETRY.height}`} preserveAspectRatio="none" role="img" aria-label={`${subtitle.toLowerCase()} chart`}>
            {scale.ticks.map((tick)=><line key={tick} className="ts-grid" x1="0" y1={yPosition(tick,scale)} x2={GEOMETRY.width} y2={yPosition(tick,scale)}/>)}
            {children}
          </svg>
        </div>
        {labels&&<div className="ts-xaxis">{labels.map((entry)=><span key={entry.index}>{entry.label}</span>)}</div>}
      </div>
    </div>
    {series&&series.length>0&&<footer className="ts-legend">{series.map((entry)=><span key={entry.name}><i style={{background:entry.color}}/>{entry.name}</span>)}</footer>}
    {foot}
  </article>;
}

/** Filled line series with an optional gradient band under the primary line. */
function LineSeries({series,scale}:{series:Series[];scale:Scale}) {
  return <>{series.some((entry)=>entry.points.length>1)&&series[0].points.filter((point)=>point.value!==null).length>1&&<path className="ts-band" style={{fill:series[0].color}} d={areaPath(series[0].points,scale)}/>}{series.map((entry)=><path key={entry.name} className="ts-line" style={{stroke:entry.color}} d={linePath(entry.points,scale)}/>)}</>;
}

/** Horizontal rain probability / UV risk bands drawn behind a series. */
function riskBands(scale:Scale,edges:{at:number;color:string}[]) {
  const sorted=[...edges].sort((a,b)=>a.at-b.at);
  return sorted.map((edge,index)=>{const next=sorted[index+1]?.at??scale.max;const top=yPosition(next,scale),bottom=yPosition(edge.at,scale);return <rect key={edge.at} className="ts-risk" style={{fill:edge.color}} x="0" y={top} width={GEOMETRY.width} height={Math.max(0,bottom-top)}/>;});
}

/** Sun's path between sunrise and sunset with the current position marked, so the daylight panel earns its width. */
function DaylightArc({sunrise,sunset,now}:{sunrise:string;sunset:string;now:string}) {
  const at=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?0:date.getTime();};
  const rise=at(sunrise), set=at(sunset), current=at(now);
  const daylight=Math.max(set-rise,1);
  const progress=Math.min(Math.max((current-rise)/daylight,0),1);
  const x=4+progress*92, y=46-Math.sin(progress*Math.PI)*34;
  const night=current<rise||current>set;
  return <div className="sun-arc">
    <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label="Sunrise to sunset arc">
      <path className="arc-horizon" d="M2 46 H98"/>
      <path className="arc-path" d="M4 46 A 46 40 0 0 1 96 46"/>
      <path className="arc-done" d="M4 46 A 46 40 0 0 1 96 46" pathLength={1} strokeDasharray={`${progress} 1`}/>
      {night?<circle className="arc-moon" cx={x} cy={y} r={2.4}/>:<circle className="arc-sun" cx={x} cy={y} r={3}/>}
    </svg>
    <div className="arc-ends"><span>SUNRISE<br/><b>{timeLabel(sunrise)}</b></span><span className="arc-mid">{night?"Night":"Daylight"} {Math.round(progress*100)}%</span><span>SUNSET<br/><b>{timeLabel(sunset)}</b></span></div>
  </div>;
}

/** Daily high/low range bars, scaled to the data instead of a fixed zero baseline. */
function DailyRangeChart({days,unit,scale,labels}:{days:{date:string;max:number;min:number}[];unit:string;scale:Scale;labels:AxisLabel[]}) {
  const highs=days.map((day)=>day.max),lows=days.map((day)=>day.min);
  return <ChartCard title="Highs and lows" subtitle="7-DAY TEMPERATURE" scale={scale} kind="temperature" unit={unit} labels={labels} series={[{name:"Daily high",color:"#3d8bfd",points:[]},{name:"Daily low",color:"#ff9f43",points:[]}]}>
    {days.map((day,index)=>{
      const slot=GEOMETRY.width/days.length;
      const x=index*slot+slot/2;
      const width=slot*0.36;
      const top=yPosition(day.max,scale), bottom=yPosition(day.min,scale);
      return <g key={day.date} className="range-bar"><rect x={x-width/2} y={top} width={width} height={Math.max(1,bottom-top)} rx={1}/><circle cx={x} cy={top} r={1.15} className="range-max"/><circle cx={x} cy={bottom} r={1.15} className="range-min"/></g>;
    })}
  </ChartCard>;
}

export function WeatherDashboard({dashboard}:{dashboard:Dashboard}) {
  const base=dashboard.weather!;
  const [place,setPlace]=useState(base); const [query,setQuery]=useState(""); const [data,setData]=useState<WeatherResponse>();
  const [error,setError]=useState<string>(); const [loading,setLoading]=useState(true); const [updated,setUpdated]=useState<Date>();
  const [span,setSpan]=useState<48|168>(48);
  const load=useCallback(async()=>{
    setLoading(true); setError(undefined);
    const params=new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),current:"temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,is_day",hourly:"temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,uv_index,visibility",daily:"weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,uv_index_clear_sky_max",timezone:"auto",forecast_days:"7",temperature_unit:place.temperatureUnit});
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
  const speed=data.current_units.wind_speed_10m;
  const slice=<T,>(values:T[])=>values.slice(currentHour,currentHour+span) as T[];
  const labels=timeAxis(slice(data.hourly.time),span>=168?7:8);
  const rangeLabel=span>=168?"Next 7 days":`Next ${span/24} days`;
  const temperatureScale=scaleDomain([...slice(data.hourly.temperature_2m),...slice(data.hourly.apparent_temperature)]);
  const rainScale=scaleDomain(slice(data.hourly.precipitation_probability),{fixed:[0,100]});
  const mmScale=scaleDomain(slice(data.hourly.precipitation),{zero:true});
  const windScale=scaleDomain([...slice(data.hourly.wind_speed_10m),...slice(data.hourly.wind_gusts_10m)],{zero:true});
  const humidityScale=scaleDomain(slice(data.hourly.relative_humidity_2m),{fixed:[0,100]});
  const uvScale=scaleDomain(slice(data.hourly.uv_index),{zero:true});
  const dailyScale=scaleDomain([...data.daily.temperature_2m_max,...data.daily.temperature_2m_min]);
  const dailyWindScale=scaleDomain([...data.daily.wind_speed_10m_max,...data.daily.wind_gusts_10m_max],{zero:true});
  const dailyRainScale=scaleDomain(data.daily.precipitation_probability_max,{fixed:[0,100]});
  const dailyUvScale=scaleDomain(data.daily.uv_index_max,{zero:true});
  const dailyLabels=data.daily.time.map((date,index)=>({index,label:dayName(date,index)}));
  const dailyRainBars=barsFor(data.daily.precipitation_probability_max,dailyRainScale);
  const days=data.daily.time.map((date,index)=>({date,max:data.daily.temperature_2m_max[index],min:data.daily.temperature_2m_min[index],rain:data.daily.precipitation_sum[index],probability:data.daily.precipitation_probability_max[index]}));
  const dailyMmScale=scaleDomain(data.daily.precipitation_sum,{zero:true});
  const dailyMmBars=barsFor(data.daily.precipitation_sum,dailyMmScale);
  const summary=(values:number[],formatter:(value:number)=>string)=>values.length?`${formatter(Math.min(...values))} – ${formatter(Math.max(...values))}`:"";
  const tempFormatter=(value:number)=>`${Math.round(value)}°`;
  return <section className="weather-workspace">
    <header className="weather-topbar"><div><p className="weather-kicker">LIVE FORECAST</p><h1>{place.location}</h1><p><MapPin size={13}/>{place.latitude.toFixed(2)}°, {place.longitude.toFixed(2)}° · {data.timezone_abbreviation}</p></div><div className="weather-tools"><form onSubmit={findLocation}><Search size={16}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Change location" aria-label="Search location"/></form><button onClick={load} title="Refresh forecast"><RefreshCw size={17}/><span>{loading?"Refreshing":"Refresh"}</span></button></div></header>
    {error&&<div className="weather-warning">Latest refresh failed. Showing the most recent forecast.</div>}
    <div className="weather-grid">
      <article className="weather-now"><div className="weather-orbit"><WeatherGlyph code={data.current.weather_code} size={92} day={Boolean(data.current.is_day)}/></div><div className="weather-current-copy"><p>{descriptions[data.current.weather_code]??"Current conditions"}</p><strong>{Math.round(data.current.temperature_2m)}<sup>{unit}</sup></strong><span>Feels like {Math.round(data.current.apparent_temperature)}{unit}</span></div><div className="weather-facts">
        <div><Droplets/><span>Humidity</span><b>{data.current.relative_humidity_2m}%</b></div>
        <div><Wind/><span>Wind</span><b>{Math.round(data.current.wind_speed_10m)} {speed} {compass(data.current.wind_direction_10m)}</b></div>
        <div><CloudRain/><span>Rain</span><b>{data.current.precipitation} {data.current_units.precipitation}</b></div>
        <div><Gauge/><span>Pressure</span><b>{Math.round(data.current.surface_pressure)} {data.current_units.surface_pressure}</b></div>
        <div><Thermometer/><span>Today's high</span><b>{Math.round(data.daily.temperature_2m_max[todayIndex])}{unit}</b></div>
        <div><Thermometer/><span>Today's low</span><b>{Math.round(data.daily.temperature_2m_min[todayIndex])}{unit}</b></div>
      </div></article>
      <article className="weather-hourly"><div className="weather-card-head"><div><p>NEXT 24 HOURS</p><h2>Through the day</h2></div><span>{updated?`Updated ${updated.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}`:"Live"}</span></div><div className="hour-strip">{data.hourly.time.slice(currentHour,currentHour+24).map((time,index)=>{const at=currentHour+index;return <div className={index===0?"current":""} key={time}><time>{index===0?"Now":timeLabel(time)}</time><WeatherGlyph code={data.hourly.weather_code[at]} size={25}/><b>{Math.round(data.hourly.temperature_2m[at])}°</b><small>{data.hourly.precipitation_probability[at]}%</small></div>})}</div></article>
      <article className="weather-week"><div className="weather-card-head"><div><p>7-DAY OUTLOOK</p><h2>The week ahead</h2></div><Navigation size={18}/></div><div className="week-list">{data.daily.time.map((date,index)=><div key={date}><b>{dayName(date,index)}</b><span className="condition"><WeatherGlyph code={data.daily.weather_code[index]} size={24}/>{descriptions[data.daily.weather_code[index]]??"Mixed"}</span><span className="rain"><Droplets size={14}/>{data.daily.precipitation_probability_max[index]}%</span><span className="temps"><strong>{Math.round(data.daily.temperature_2m_max[index])}°</strong><small>{Math.round(data.daily.temperature_2m_min[index])}°</small></span></div>)}</div></article>
      <aside className="weather-sun">
        <div className="weather-card-head"><div><p>SUN &amp; DAYLIGHT</p><h2>Today at a glance</h2></div><Sun size={18}/></div>
        <DaylightArc sunrise={data.daily.sunrise[todayIndex]} sunset={data.daily.sunset[todayIndex]} now={data.current.time}/>
        <div className="sun-facts">
          <div><Sunrise/><span>Sunrise</span><b>{timeLabel(data.daily.sunrise[todayIndex])}</b></div>
          <div><Sunset/><span>Sunset</span><b>{timeLabel(data.daily.sunset[todayIndex])}</b></div>
          <div><Umbrella/><span>Rain today</span><b>{data.daily.precipitation_sum[todayIndex]} mm</b></div>
          <div><Eye/><span>UV index</span><b>{Math.round(data.daily.uv_index_max[todayIndex])}</b></div>
          <div><Wind/><span>Max wind</span><b>{Math.round(data.daily.wind_speed_10m_max[todayIndex])} {speed}</b></div>
          <div><Wind/><span>Gusts</span><b>{Math.round(data.daily.wind_gusts_10m_max[todayIndex])} {speed}</b></div>
        </div>
        <p className="sun-credit">Data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></p>
      </aside>
    </div>
    <div className="weather-range-controls"><div><p className="weather-kicker">METRIC DETAIL</p><h2 className="range-title">{rangeLabel} · every metric</h2></div><div className="range-toggle" role="group" aria-label="Forecast range"><button className={span===48?"active":""} onClick={()=>setSpan(48)}>48 HOURS</button><button className={span===168?"active":""} onClick={()=>setSpan(168)}>7 DAYS</button></div></div>
    <div className="weather-charts">
      <ChartCard title="Temperature" subtitle="AIR VS FEELS LIKE" summary={summary(slice(data.hourly.temperature_2m),tempFormatter)} scale={temperatureScale} kind="temperature" labels={labels} series={[{name:"Air",color:"#3d8bfd",points:toPoints(slice(data.hourly.temperature_2m))},{name:"Feels like",color:"#ff9f43",points:toPoints(slice(data.hourly.apparent_temperature))}]}>
        <LineSeries series={[{name:"Air",color:"#3d8bfd",points:toPoints(slice(data.hourly.temperature_2m))},{name:"Feels like",color:"#ff9f43",points:toPoints(slice(data.hourly.apparent_temperature))}]} scale={temperatureScale}/>
      </ChartCard>
      <ChartCard title="Chance of rain" subtitle="PRECIPITATION PROBABILITY" summary={summary(slice(data.hourly.precipitation_probability),(v)=>`${Math.round(v)}%`)} scale={rainScale} kind="percent" labels={labels} series={[{name:"Rain chance",color:"#39c5cf",points:toPoints(slice(data.hourly.precipitation_probability))}]}>
        <LineSeries series={[{name:"Rain chance",color:"#39c5cf",points:toPoints(slice(data.hourly.precipitation_probability))}]} scale={rainScale}/>
      </ChartCard>
      <ChartCard title="Rainfall" subtitle="PRECIPITATION · MM" summary={summary(slice(data.hourly.precipitation),(v)=>`${v.toFixed(1)} mm`)} scale={mmScale} kind="mm" labels={labels} series={[{name:"Rainfall",color:"#4a9eff",points:toPoints(slice(data.hourly.precipitation))}]}>
        {barsFor(slice(data.hourly.precipitation),mmScale).map((bar,index)=><rect key={index} className="ts-bar" style={{fill:rainTint(bar.value)}} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={0.5}/>)}
      </ChartCard>
      <ChartCard title="Wind" subtitle="SPEED AND GUSTS" summary={summary(slice(data.hourly.wind_speed_10m),(v)=>`${Math.round(v)}`)} scale={windScale} kind="speed" labels={labels} series={[{name:"Wind",color:"#3fb950",points:toPoints(slice(data.hourly.wind_speed_10m))},{name:"Gusts",color:"#8f7cff",points:toPoints(slice(data.hourly.wind_gusts_10m))}]}>
        <LineSeries series={[{name:"Wind",color:"#3fb950",points:toPoints(slice(data.hourly.wind_speed_10m))},{name:"Gusts",color:"#8f7cff",points:toPoints(slice(data.hourly.wind_gusts_10m))}]} scale={windScale}/>
      </ChartCard>
      <ChartCard title="Humidity" subtitle="RELATIVE HUMIDITY" summary={summary(slice(data.hourly.relative_humidity_2m),(v)=>`${Math.round(v)}%`)} scale={humidityScale} kind="percent" labels={labels} series={[{name:"Humidity",color:"#57b6c9",points:toPoints(slice(data.hourly.relative_humidity_2m))}]}>
        <LineSeries series={[{name:"Humidity",color:"#57b6c9",points:toPoints(slice(data.hourly.relative_humidity_2m))}]} scale={humidityScale}/>
      </ChartCard>
      <ChartCard title="UV index" subtitle="ULTRAVIOLET · MAX PER HOUR" summary={summary(slice(data.hourly.uv_index),(v)=>v.toFixed(1))} scale={uvScale} kind="plain" labels={labels} series={[{name:"UV index",color:"#ffb547",points:toPoints(slice(data.hourly.uv_index))}]}>
        {riskBands(uvScale,[{at:3,color:"#ffd16622"},{at:6,color:"#ff9f4322"},{at:8,color:"#ff6b6b22"},{at:11,color:"#d16bff22"}])}
        <LineSeries series={[{name:"UV index",color:"#ffb547",points:toPoints(slice(data.hourly.uv_index))}]} scale={uvScale}/>
      </ChartCard>
    </div>
    <div className="weather-range-controls"><div><p className="weather-kicker">DAILY OUTLOOK</p><h2 className="range-title">Seven days of highs, lows and rain</h2></div></div>
    <div className="weather-charts">
      <DailyRangeChart days={days} unit={unit} scale={dailyScale} labels={dailyLabels}/>
      <ChartCard title="Daily rain chance" subtitle="7-DAY PROBABILITY" scale={dailyRainScale} kind="percent" labels={dailyLabels}>
        {dailyRainBars.map((bar,index)=><rect key={index} className="ts-bar" style={{fill:bar.value>0?"#39c5cf":"#2c3a44"}} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={0.5}/>)}
      </ChartCard>
      <ChartCard title="Daily wind" subtitle="MAX SPEED AND GUSTS" scale={dailyWindScale} kind="speed" unit={speed} labels={dailyLabels} series={[{name:"Max wind",color:"#3fb950",points:toPoints(data.daily.wind_speed_10m_max)},{name:"Max gust",color:"#8f7cff",points:toPoints(data.daily.wind_gusts_10m_max)}]}>
        <LineSeries series={[{name:"Max wind",color:"#3fb950",points:toPoints(data.daily.wind_speed_10m_max)},{name:"Max gust",color:"#8f7cff",points:toPoints(data.daily.wind_gusts_10m_max)}]} scale={dailyWindScale}/>
      </ChartCard>
      <ChartCard title="Total rainfall" subtitle="DAILY MM" scale={dailyMmScale} kind="mm" labels={dailyLabels} series={[{name:"Rainfall",color:"#4a9eff",points:toPoints(data.daily.precipitation_sum)}]}>
        {dailyMmBars.map((bar,index)=><rect key={index} className="ts-bar" style={{fill:rainTint(bar.value)}} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={0.5}/>)}
      </ChartCard>
    </div>
  </section>;
}