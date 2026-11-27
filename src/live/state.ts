import { meetingSchema, type Meeting } from '../schema.js';
export interface Session { revision: number; nextSpeaker: number; meeting?: Meeting; names: Record<string,string>; busy: boolean; sequence: number; }
export const createSession = (): Session => ({ revision: 0, nextSpeaker: 1, names: {}, busy: false, sequence: -1 });
/** Reconcile anonymous clusters using the SAME audio timeline, never by label equality. */
export function reconcile(session: Session, incoming: Meeting): Meeting {
  const m = meetingSchema.parse(incoming);
  const scores = new Map<string, Map<string, number>>();
  for (const s of m.segments) {
    if (!s.speaker) continue;
    const row = scores.get(s.speaker) ?? new Map<string, number>(); scores.set(s.speaker, row);
    for (const p of session.meeting?.segments ?? []) {
      if (!p.speaker) continue;
      const overlap = Math.max(0, Math.min(s.end, p.end) - Math.max(s.start, p.start));
      row.set(p.speaker, (row.get(p.speaker) ?? 0) + overlap);
    }
  }
  const mapping = new Map<string,string>(); const used = new Set<string>();
  const ranked = [...scores].map(([id,row]) => ({id, row:[...row].sort((a,b)=>b[1]-a[1])})).sort((a,b)=>(b.row[0]?.[1]??0)-(a.row[0]?.[1]??0));
  for (const {id,row} of ranked) {
    const best = row[0]; const total = row.reduce((n,v)=>n+v[1],0);
    // Merge/split ambiguity gets a fresh ID; never silently inherit a confirmed name.
    const competing = best ? [...scores].filter(([other])=>other!==id).some(([,r])=>(r.get(best[0])??0) > best[1]*0.2) : true;
    if(best && best[1]>=1 && best[1]/total>=0.85 && !competing && !used.has(best[0])) { mapping.set(id,best[0]); used.add(best[0]); }
  }
  for(const id of Object.keys(m.speakers)) if(!mapping.has(id)) mapping.set(id,`S${session.nextSpeaker++}`);
  m.speakers=Object.fromEntries([...mapping.values()].map(id=>[id,session.names[id]??id]));
  for(const s of m.segments){ if(s.speaker) s.speaker=mapping.get(s.speaker)!; if(s.candidates) s.candidates=s.candidates.map(c=>({...c,speaker:mapping.get(c.speaker)!})); }
  m.insights=[]; // Old evidence IDs belong to the old revision.
  return meetingSchema.parse(m);
}
