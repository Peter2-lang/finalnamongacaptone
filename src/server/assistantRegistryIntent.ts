import { HINUNANGAN_BARANGAYS } from '../data/barangays';
import type { AssistantScope } from './assistantEngine';
export type RegistryIntent = {args:Record<string,unknown>; denied?:boolean};
export function registryLanguage(message:string, selected:unknown):'en'|'ceb'|'fil' {
  if (/\b(unsa|pila|baboy.*narehistro|karong|adunay|palihog|karon)\b/i.test(message)) return 'ceb';
  if (/\b(ano|ilan|ilang|ngayon|nakarehistro|mga|paano)\b/i.test(message)) return 'fil';
  if (/\b(what|how|show|registered|latest)\b/i.test(message)) return 'en';
  return selected==='ceb'||selected==='fil'?selected:'en';
}
/** A bounded read-only grammar. Unrecognized questions continue to the provider tools. */
export function resolveRegistryQuestion(message:string, scope:AssistantScope, history?:unknown):RegistryIntent|null {
  let text=message.toLowerCase().trim();
  const quantity=/\b(how many|count|number of|total|pila|ilan|ilang|statistics|summary|summaries)\b/.test(text);
  const latest=/\b(latest|recent|pinakabag.o|pinakabagong)\b/.test(text);
  const asf=/\b(asf|biosecurity)\b/.test(text)&&/\b(status|zone|barangay|evaluation|assessment|evaluations)\b/.test(text);
  if (!quantity&&!latest&&!asf) return null;
  const historyTurns=Array.isArray(history)?history.filter(t=>t?.role==='user'&&typeof t.content==='string'):[];
  if (/\b(those|these|them|ana|niini|iyon)\b/.test(text)) {
    const previous=historyTurns.at(-1)?.content;
    if(previous) text=`${previous.toLowerCase()} ${text}`;
  }
  let metric=/\b(farmers?|mag.uuma|magsasaka)\b/.test(text)?'farmers':/\b(certificates?|sertipiko)\b/.test(text)?'certificates':/\b(archived?|arkibo|na.archive)\b/.test(text)?'archived':asf?'biosecurity':latest?'latest':'summary';
  if(metric==='summary'&&!/\b(swine|pigs?|baboy|records?|rekord|rehistr|registered|registration|registry|barangay)\b/.test(text)&&!text.includes('rehistro')) return null;
  // Classification, status and compound filters require the model's structured tool path.
  if (/\b(piglets?|boars?|sows?|growers?|breeds?|breeding|sold|deceased|weight|female|male|backyard|commercial)\b/.test(text)) return null;
  if (metric!=='archived' && /\b(archived?|arkibo)\b/.test(text)) return null;
  const matches=HINUNANGAN_BARANGAYS.filter(b=>text.includes(b.name.toLowerCase()));
  const period=/\b(today|karong adlawa|karon|ngayon)\b/.test(text)?'today':/\b(week|semana|linggo)\b/.test(text)?'week':/\b(month|buwan|bulan)\b/.test(text)?'month':'all';
  const readyOnly=/\b(ready|sell|baligya|ibenta|take.off)\b/.test(text);
  const assigned=scope.assignedBarangay?.trim().toLowerCase();
  if(matches.length>1 && scope.role!=='focal') return null;
  const denied=(scope.role==='focal'&&(!assigned||matches.some(b=>b.name.toLowerCase()!==assigned))) || (scope.role==='agent'&&['farmers','certificates','archived','biosecurity'].includes(metric));
  // Never silently ignore an unrecognized explicit barangay filter.
  if(!matches.length && /\b(in|sa)\s+(?:barangay\s+)?[a-z]/.test(text) && !/\b(in|sa)\s+(my|among|akong|aming|aking|the|hinunangan|pagkakaron)\b/.test(text)) return null;
  return {args:{metric,period,readyOnly,...(/summar/.test(text)?{view:'summary'}:{}),...(matches.length===1?{barangay:matches[0].name}:{})},denied};
}
export function formatRegistryAnswer(value:unknown,intent:RegistryIntent,language:string):string {
  const data=value as any;
  if(!data||typeof data!=='object')throw new Error('Invalid registry result');
  const scope=String(data.scope || 'Hinunangan');
  const period=String(data.period || 'all');
  const suffix=period==='all'?'':language==='ceb'?` (${period==='today'?'karong adlawa':period==='week'?'niining semanaha':'niining bulana'})`:language==='fil'?` (${period==='today'?'ngayon':period==='week'?'ngayong linggo':'ngayong buwan'})`:` (${period==='today'?'today':`this ${period}`})`;
  if(intent.args.metric==='biosecurity') {
    if(!Array.isArray(data.assessments)) throw new Error('Invalid assessments');
    const seen=new Set<string>();const assessments=data.assessments.filter((a:any)=>{if(seen.has(a.barangay))return false;seen.add(a.barangay);return true;});
    const heading=language==='ceb'?'Pinakabag-ong aprobada nga mga pagsusi':language==='fil'?'Pinakabagong aprubadong pagsusuri':'Latest approved assessments';
    return assessments.length?`${heading} — ${scope}:\n${assessments.map((a:any)=>`${a.barangay}: ${a.zone}, ${a.status} (${a.date})`).join('\n')}\n${language==='ceb'?'Dili kini live nga diagnosis.':language==='fil'?'Hindi ito kasalukuyang diagnosis.':'These are recorded assessments, not a current disease diagnosis.'}`:language==='ceb'?`Walay aprobada nga pagsusi sa ASF/biosecurity alang sa ${scope}.`:language==='fil'?`Walang aprubadong pagsusuri sa ASF/biosecurity para sa ${scope}.`:`No approved ASF/biosecurity assessment is recorded for ${scope}.`;
  }
  const key=intent.args.metric==='farmers'?'totalFarmers':intent.args.metric==='certificates'?'totalCertificates':'totalSwine';
  const count=data[key];
  if(!Number.isSafeInteger(count)||count<0)throw new Error('Invalid live count');
  const noun=intent.args.metric==='farmers'?['registered farmers','rehistradong mag-uuma','rehistradong magsasaka']:intent.args.metric==='certificates'?['issued certificates','giisyu nga sertipiko','inisyu na sertipiko']:intent.args.metric==='archived'?['archived swine records','giarkibo nga rekord sa baboy','naka-archive na tala ng baboy']:intent.args.readyOnly===true||scope==='Authorized ready-to-sell catalog'?['ready-to-sell swine records','rekord sa baboy nga andam ibaligya','tala ng baboy na handang ibenta']:['registered swine records','rehistradong baboy','rehistradong baboy'];
  let reply=language==='ceb'?`Sa pagkakaron, adunay ${count} ka ${noun[1]} sa ${scope}${suffix}.`:language==='fil'?`Sa kasalukuyan, may ${count} ${noun[2]} sa ${scope}${suffix}.`:`Currently, there are ${count} ${noun[0]}${scope==='Hinunangan'?'':` in ${scope}`}${suffix}.`;
  if(intent.args.metric==='latest'&&count>0) {
    if(!Array.isArray(data.latest))throw new Error('Invalid latest records');
    reply+='\n'+data.latest.map((r:any)=>`${r.tag} — ${r.barangay}; ${r.swineType || 'Unspecified'}; ${r.registeredAt || 'Date unavailable'}`).join('\n');
  }
  if(/summar/.test(String(intent.args.view))&&data.byBarangay)reply+='\n'+Object.entries(data.byBarangay).map(([b,n])=>`${b}: ${n}`).join('\n');
  return reply;
}
