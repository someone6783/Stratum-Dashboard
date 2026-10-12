import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import DOMPurify from "dompurify";
import { Activity, Boxes, Clock3, CloudSun, Command, Edit3, ExternalLink, Gauge, GitCommit, Search, Sparkles } from "lucide-react";
import { dashboardSchema, defaultDashboard, searchDashboard, weatherDashboard, type Dashboard, type Widget } from "../shared/dashboard";
import { WeatherDashboard } from "./WeatherDashboard";
import { PrometheusWidgetPanel } from "./PrometheusWidget";

const EditorDrawer = lazy(() => import("./EditorDrawer"));
const dashboardIdFromHash = () => location.hash === "#search" ? "search-home" : location.hash === "#weather" ? "weather" : "overview";
const fallbackDashboard = (id:string) => id === "search-home" ? searchDashboard : id === "weather" ? weatherDashboard : defaultDashboard;

async function loadDashboard(id: string) {
  const response = await fetch(`/api/dashboards/${id}`);
  if (!response.ok) throw new Error("Could not load dashboard");
  return dashboardSchema.parse(await response.json());
}

function WidgetCard({ widget, embedOrigins }: { widget: Widget; embedOrigins:string[] }) {
  const style = { gridColumn: `span ${widget.grid.colSpan}` };
  if (widget.type === "section") return <h2 className="section-head" style={style}>{widget.title}</h2>;
  if (widget.type === "prometheus") return <PrometheusWidgetPanel widget={widget}/>;
  if (widget.type === "metric") return <article className={`panel metric ${widget.accent}`} style={style}><div className="panel-label"><span>{widget.title}</span><Activity size={17}/></div><strong>{widget.value}</strong><p><b>{widget.detail}</b></p>{widget.trend && <div className="mini-bars">{widget.trend.map((n,i)=><i key={i} style={{height:`${n}%`}}/>)}</div>}</article>;
  if (widget.type === "status") return <article className="panel system-card" style={style}><div className="panel-label"><span>{widget.title}</span><span className="live">LIVE</span></div>{widget.items.map((item)=><div className="system-row" key={item.name}><span className="ok-dot"/><div><b>{item.name}</b><small>{item.status}</small></div><em>{item.value}</em></div>)}</article>;
  if (widget.type === "links") return <article className="panel shortcuts" style={style}><div className="panel-label"><span>{widget.title}</span></div>{widget.items.map((item)=><a key={item.label} href={item.url} target="_blank" rel="noreferrer"><i>{item.label.slice(0,2).toUpperCase()}</i><span><b>{item.label}</b><small>{item.hint}</small></span><ExternalLink size={14}/></a>)}</article>;
  if (widget.type === "html") return <article className="panel html-card" style={style}><div className="panel-label"><span>{widget.title}</span></div><div className="prose" dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(widget.html)}}/></article>;
  if (widget.type === "embed") {
    const allowed=embedOrigins.includes("*")||embedOrigins.includes(new URL(widget.url).origin);
    return <article className="panel embed-card" style={style}><div className="panel-label"><span>{widget.title}</span></div>{allowed?<iframe title={widget.title} src={widget.url} sandbox="allow-scripts allow-forms allow-popups" style={{height:widget.height}}/>:<div className="embed-blocked">This origin is not allowed by the server.</div>}</article>;
  }
  const max = Math.max(...widget.values,1);
  const points = widget.values.map((value,index)=>`${index*(720/Math.max(widget.values.length-1,1))} ${180-(value/max)*145}`).join(" L");
  return <article className="panel chart-card" style={style}><div className="chart-head"><div><div className="panel-label"><span>{widget.title}</span></div><strong>{widget.value}</strong><small> {widget.detail}</small></div></div><div className="chart"><div className="grid-lines"/><svg viewBox="0 0 720 180" role="img" aria-label={`${widget.title} chart`}><defs><linearGradient id={`fill-${widget.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".2"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs><path className="area" style={{fill:`url(#fill-${widget.id})`}} d={`M0 180 L${points} L720 180 Z`}/><path className="line" d={`M${points}`}/></svg><div className="axis">{widget.labels.map((label)=><span key={label}>{label}</span>)}</div></div></article>;
}

function SearchHome({ dashboard }: { dashboard: Dashboard }) {
  const config = dashboard.search!;
  const providers = { google:"https://www.google.com/search", duckduckgo:"https://duckduckgo.com/", bing:"https://www.bing.com/search" };
  return <section className="search-home"><div className="search-brand"><i/><i/></div><p className="eyebrow">{new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}).toUpperCase()}</p><h1>{dashboard.title}</h1><form action={providers[config.provider]}><Search size={20}/><input autoFocus name="q" placeholder={config.placeholder}/><kbd>ENTER</kbd></form><div className="search-shortcuts">{config.shortcuts.map((item)=><a href={item.url} key={item.label}><b>{item.label.slice(0,2).toUpperCase()}</b><span>{item.label}</span></a>)}</div></section>;
}

export function App() {
  const initialId=dashboardIdFromHash();
  const [activeId,setActiveId] = useState(initialId);
  const [dashboard,setDashboard] = useState<Dashboard>(()=>fallbackDashboard(initialId));
  const [embedOrigins,setEmbedOrigins]=useState<string[]>([]);
  const [datasource,setDatasource]=useState<{configured:boolean;url:string|null}>();
  const [release,setRelease]=useState<{date:string;sha:string;subject:string}|null>(null);
  const [editing,setEditing] = useState(false);
  const [notice,setNotice] = useState<string>();

  useEffect(()=>{ let active=true; loadDashboard(activeId).then((value)=>active&&setDashboard(value)).catch(()=>setNotice("Using the bundled dashboard while the API reconnects.")); return()=>{active=false}; },[activeId]);
  useEffect(()=>{
    fetch("/api/config").then((response)=>response.json()).then((value)=>{setEmbedOrigins(value.embedOrigins??[]);setDatasource(value.prometheus);}).catch(()=>setEmbedOrigins([]));
    fetch("/api/release").then((response)=>response.json()).then((value)=>setRelease(value.release??null)).catch(()=>setRelease(null));
    const sync=()=>{const id=dashboardIdFromHash();setActiveId(id);setDashboard(fallbackDashboard(id));};
    addEventListener("hashchange",sync); return()=>removeEventListener("hashchange",sync);
  },[]);

  const open = (id:string) => { setActiveId(id); setDashboard(fallbackDashboard(id)); location.hash=id === "search-home" ? "search" : id; };
  const save = async (value:Dashboard) => { const response=await fetch(`/api/dashboards/${value.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)}); const result=await response.json(); if(!response.ok) throw new Error(result.error??"Save failed"); const parsed=dashboardSchema.parse(result); setDashboard(parsed); setEditing(false); setNotice(`Saved revision ${parsed.revision}.`); };

  return <div className="app-shell" style={{"--accent":dashboard.theme.accent} as CSSProperties}>
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={()=>open("overview")}><span className="brand-mark"><i/><i/></span><b>STRATUM</b></a>
      <nav aria-label="Dashboards"><p className="eyebrow">WORKSPACE</p><button className={`nav-item ${activeId==="overview"?"active":""}`} onClick={()=>open("overview")}><Gauge size={18}/> Overview <span>⌘1</span></button><button className={`nav-item ${activeId==="weather"?"active":""}`} onClick={()=>open("weather")}><CloudSun size={18}/> Weather <span>⌘2</span></button><button className={`nav-item ${activeId==="search-home"?"active":""}`} onClick={()=>open("search-home")}><Search size={18}/> Search home <span>⌘3</span></button><a className="nav-item" href="/api/dashboards" target="_blank"><Boxes size={18}/> JSON index</a></nav>
      <div className="sidebar-foot"><span className="status-dot"/> Docker API ready</div>
      {datasource&&<div className="sidebar-foot datasource"><span className={`status-dot ${datasource.configured?"":"off"}`}/> <span className="datasource-text">Prometheus {datasource.configured?datasource.url:"not configured"}</span></div>}
      {release&&<div className="sidebar-foot release" title={release.subject}><GitCommit size={13}/><span>Release</span><time dateTime={release.date}>{new Date(release.date).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}</time><b>{release.sha}</b></div>}
    </aside>
    <main className={dashboard.mode==="weather"?"weather-main":undefined}>
      {dashboard.mode === "weather" ? <><div className="weather-edit"><a href={`/published/${dashboard.id}`} target="_blank">Fast view</a><button onClick={()=>setEditing(true)}><Edit3 size={15}/> Edit JSON</button></div><WeatherDashboard dashboard={dashboard}/></> : dashboard.mode === "search" ? <><div className="search-actions"><a href={`/published/${dashboard.id}`} target="_blank">Open fast view</a><button className="primary" onClick={()=>setEditing(true)}><Edit3 size={16}/> Edit JSON</button></div><SearchHome dashboard={dashboard}/></> : <><header className="topbar"><div><p className="eyebrow">DASHBOARD / {dashboard.id.toUpperCase()}</p><h1>{dashboard.title}</h1>{dashboard.description&&<p className="subtitle">{dashboard.description}</p>}</div><div className="actions"><a className="quiet" href={`/published/${dashboard.id}`} target="_blank"><Clock3 size={16}/> Fast view</a><button className="primary" onClick={()=>setEditing(true)}><Edit3 size={16}/> Edit JSON</button></div></header><section className="dashboard-grid" aria-label="Dashboard widgets">{dashboard.widgets.map((widget)=><WidgetCard widget={widget} embedOrigins={embedOrigins} key={widget.id}/>)}</section><article className="panel command-card"><div><Sparkles size={19}/><span>JSON DRIVEN</span></div><p>Every panel is defined by the saved dashboard document. PromQL panels resolve live through the server proxy.</p><button onClick={()=>setEditing(true)}><Command size={15}/> Edit definition</button></article></>}
      {notice&&<button className="toast" onClick={()=>setNotice(undefined)}>{notice}</button>}
    </main>
    {editing&&<Suspense fallback={<div className="drawer-loading">Opening editor…</div>}><EditorDrawer dashboard={dashboard} onClose={()=>setEditing(false)} onSave={save}/></Suspense>}
  </div>;
}
