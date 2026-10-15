import {accessError} from './access';
import {rupSeedText,packedText} from '../../server/seeds';
import {withRupCareer} from './rup';
import type {RupData} from './rup';
import {resources} from './store';

import {unpackAgentSeed,normalizeNNI,withConfirmedPresence} from './agents';
import type {AgentData,AgentRecord} from './agents';
let decoded:AgentData|undefined;
export function agentBase(){return decoded ||=unpackAgentSeed(JSON.parse(packedText));}
export async function agentAuth(request:Request,write=false){const denied=accessError(request,write);if(denied){const body=await denied.json() as {error:string};throw Object.assign(Error(body.error),{status:denied.status});}}
export const agentError=(e:any)=>Response.json({error:e?.message||'Opération impossible.'},{status:e?.status||500,headers:{'Cache-Control':'no-store'}});
export async function agentData(){const base=agentBase();const {db,bucket}=resources();const result=await db.prepare('SELECT * FROM agent_imports ORDER BY date,created').all<any>();const rup:RupData=JSON.parse(rupSeedText);const data:AgentData={...base,records:[...base.records],sources:[...base.sources],events:base.events};for(const m of result.results){const detail=JSON.parse(m.detail||'{}');if(detail.kind==='rup'){if(m.status==='validated'){const object=await bucket.get('agents/'+m.id+'/records.json');if(object){rup.sources.push({id:m.id,name:m.name,hash:m.hash,date:m.date,count:m.count,status:m.status});rup.records.push(...await object.json<any[]>());}}continue;}data.sources.push({id:m.id,name:m.name,hash:m.hash,date:m.date,label:m.date+' · '+m.name,sheet:'Import validé',primary:!!m.complete,...JSON.parse(m.detail||'{}'),confidence:'date choisie lors de l’import',seniorityDate:m.date,rows:m.count,agents:m.count,status:m.status});if(m.status==='validated'){const object=await bucket.get('agents/'+m.id+'/records.json');if(object){const rows=await object.json<AgentRecord[]>();data.records.push(...rows);}}}
const decisions=(await db.prepare('SELECT * FROM agent_decisions ORDER BY created,id').all<any>()).results;const links=new Map<string,string>();for(const d of decisions)if(d.kind==='link'&&d.target)links.set(d.agent,d.target);else if(d.kind==='unlink')links.delete(d.agent);data.records=data.records.map(r=>links.has(r.agentId)?{...r,agentId:links.get(r.agentId)!,nni:links.get(r.agentId),matchStatus:'rapprochement validé'}:r);return {data:withRupCareer(withConfirmedPresence(data,decisions),rup),observedData:withRupCareer(data,rup),decisions};}
export async function decision(request:Request){await agentAuth(request,true);const b:any=await request.json();if(!['link','unlink','departure','absence','return'].includes(b.kind)||typeof b.agent!=='string'||b.agent.length>100||String(b.note||'').length>1000)throw Object.assign(Error('Décision invalide.'),{status:400});const {observedData:data}=await agentData();if(!(data.records.some(r=>r.agentId===b.agent)||agentBase().records.some(r=>r.agentId===b.agent)||(await resources().db.prepare('SELECT id FROM agent_decisions WHERE agent=?').bind(b.agent).first()))||!data.sources.some(s=>s.id===b.source))throw Object.assign(Error('Agent ou source introuvable.'),{status:400});if(b.kind==='departure'&&!data.sources.find(s=>s.id===b.source)?.primary)throw Object.assign(Error('Un fichier partiel ne permet pas de confirmer un départ.'),{status:400});if(b.kind==='link'&&(!b.agent.startsWith('pending-')||normalizeNNI(b.target)!==b.target||!data.records.some(r=>r.nni===b.target)))throw Object.assign(Error('Choisir un NNI existant pour ce rapprochement.'),{status:400});let note=b.note||'';
if(b.kind==='return'){
 const src=data.sources.find(s=>s.id===b.source)!;
 const prior=data.records.filter(r=>r.agentId===b.agent&&r.nni&&(data.sources.find(s=>s.id===r.source)?.date||'9999')<src.date);
 if(src.status==='review'||!prior.length||data.records.some(r=>r.agentId===b.agent&&r.source===b.source))throw Object.assign(Error('La présence se confirme pour un agent identifié absent de cette photographie.'),{status:400});
 const v=b.presence;
 if(!v||typeof b.note!=='string'||!b.note.trim()||!Number.isInteger(v.gf)||v.gf<1||v.gf>30||!Number.isInteger(v.nr)||v.nr<1||v.nr>1000||typeof v.agency!=='string'||v.agency.length>180)throw Object.assign(Error('Renseigner le motif, un GF et un NR valides et une agence (180 caractères maximum).'),{status:400});
 note=JSON.stringify({note:b.note.trim(),presence:{gf:v.gf,nr:v.nr,agency:v.agency.trim()}});
}
await resources().db.prepare('INSERT INTO agent_decisions (id,agent,kind,target,source,note,created) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),b.agent,b.kind,b.target||null,b.source,note,new Date().toISOString()).run();return {ok:true};}
