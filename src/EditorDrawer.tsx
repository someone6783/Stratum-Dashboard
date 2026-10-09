import { useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { dashboardSchema, type Dashboard } from "../shared/dashboard";

export default function EditorDrawer({dashboard,onClose,onSave}:{dashboard:Dashboard;onClose:()=>void;onSave:(value:Dashboard)=>Promise<void>}) {
  const [source,setSource]=useState(JSON.stringify(dashboard,null,2)); const [error,setError]=useState<string>(); const [saving,setSaving]=useState(false);
  const submit=async()=>{ try { setSaving(true); setError(undefined); const parsed=dashboardSchema.parse(JSON.parse(source)); await onSave(parsed); } catch(reason) { setError(reason instanceof Error?reason.message:"Invalid JSON"); setSaving(false); } };
  return <div className="editor-backdrop" role="presentation"><section className="editor-drawer" role="dialog" aria-modal="true" aria-labelledby="editor-title"><header><div><p className="eyebrow">DEFINITION / REV {dashboard.revision}</p><h2 id="editor-title">Edit dashboard JSON</h2></div><button onClick={onClose} aria-label="Close editor"><X/></button></header><p className="editor-help">Changes are validated in the browser and again by the backend before they are saved.</p><textarea aria-label="Dashboard JSON" spellCheck={false} value={source} onChange={(event)=>setSource(event.target.value)}/>{error&&<p className="editor-error">{error}</p>}<footer><a href={`/published/${dashboard.id}`} target="_blank">Published HTML <ExternalLink size={14}/></a><button className="quiet" onClick={onClose}>Cancel</button><button className="primary" onClick={submit} disabled={saving}><Check size={16}/>{saving?"Saving…":"Validate & save"}</button></footer></section></div>;
}
