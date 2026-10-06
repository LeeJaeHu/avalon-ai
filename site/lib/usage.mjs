export const PRICING = { version:'2026-10-06-global-standard', gemini:{input:.30,output:2.50,cached:.03},jev:{input:.042} };
const count = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
export function geminiUsage(metadata, model='gemini-3.5-flash-lite') {
  const input=count(metadata?.promptTokenCount), output=count(metadata?.candidatesTokenCount);
  const total=count(metadata?.totalTokenCount);
  const thoughts=count(metadata?.thoughtsTokenCount) ?? (total!==null&&input!==null&&output!==null ? Math.max(0,total-input-output) : 0);
  const cached=count(metadata?.cachedContentTokenCount) ?? 0;
  const known=input!==null&&output!==null&&cached<=input&&model.startsWith('gemini-3.5-flash-lite');
  return {provider:'gemini',model,input,output,thoughts,cached,total:total??(known?input+output+thoughts:null),
    costUsd:known?((input-cached)*PRICING.gemini.input+cached*PRICING.gemini.cached+(output+thoughts)*PRICING.gemini.output)/1e6:null,pricingVersion:PRICING.version};
}
export function jevUsage(record) {
  return {id:record.id,provider:'jev',model:record.model??'jev-1.13.0',input:record.inputTokens,output:0,thoughts:0,cached:0,total:record.inputTokens,
    costUsd:record.costUsd??null,pricingVersion:PRICING.version,status:record.status,errorCode:record.errorCode??null};
}
export function usageSummary(records,legacyIncomplete=false) {
  const providers={gemini:{calls:0,input:0,output:0,thoughts:0,cached:0,costUsd:0,unknownCalls:0},jev:{calls:0,input:0,output:0,thoughts:0,cached:0,costUsd:0,unknownCalls:0}};
  for(const r of records){const p=providers[r.provider];if(!p)continue;p.calls++;for(const k of ['input','output','thoughts','cached'])p[k]+=r[k]??0;if(r.costUsd===null||r.costUsd===undefined)p.unknownCalls++;else p.costUsd+=r.costUsd;}
  return {providers,costUsd:providers.gemini.costUsd+providers.jev.costUsd,unknownCalls:providers.gemini.unknownCalls+providers.jev.unknownCalls,legacyIncomplete,pricingVersion:PRICING.version,currency:'USD',estimated:true};
}
export async function recordUsage(db,game,record) {
  const item={...record,id:record.id??crypto.randomUUID()};
  await db.prepare('INSERT INTO model_usage (id, game_id, state_version, detail, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET detail=excluded.detail')
    .bind(item.id,game.id,game.version,JSON.stringify(item),new Date().toISOString()).run();
}
export async function gameUsage(db,game) {
  const rows=await db.prepare('SELECT detail FROM model_usage WHERE game_id = ? ORDER BY at').bind(game.id).all();
  const records=rows.results.filter(r=>typeof r.detail==='string').map(r=>JSON.parse(r.detail));
  return {records,summary:usageSummary(records,!game.aiConfig?.usageTrackingVersion)};
}
export async function acquireAiLease(db,game,now=Date.now()) {
  const owner=crypto.randomUUID();
  const row=await db.prepare('INSERT INTO ai_locks (game_id, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE ai_locks.expires_at < ? RETURNING owner')
    .bind(game.id,owner,now+180000,now).first();
  return row?.owner===owner?owner:null;
}
export const releaseAiLease = (db,gameId,owner) => db.prepare('DELETE FROM ai_locks WHERE game_id = ? AND owner = ?').bind(gameId,owner).run();
