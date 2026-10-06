import test from'node:test';import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{readFileSync}from'node:fs';
import{geminiUsage,usageSummary,recordUsage,gameUsage,acquireAiLease,releaseAiLease}from'../lib/usage.mjs';
import{createGame,apply}from'../lib/game.mjs';import{decide}from'../lib/ai.mjs';
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../drizzle/0002_conversation_usage.sql',import.meta.url),'utf8'));return{prepare:sql=>({bind:(...values)=>({run:async()=>sqlite.prepare(sql).run(...values),first:async()=>sqlite.prepare(sql).get(...values),all:async()=>({results:sqlite.prepare(sql).all(...values)})})}),close:()=>sqlite.close()};}
test('Gemini 캐시·응답·추론 사용량과 미확인·모델 경계를 계산한다',()=>{
 const u=geminiUsage({promptTokenCount:2000,candidatesTokenCount:100,thoughtsTokenCount:300,cachedContentTokenCount:1000,totalTokenCount:2400});
 assert.equal(u.thoughts,300);assert.ok(Math.abs(u.costUsd-.00133)<1e-12);
 assert.equal(geminiUsage({promptTokenCount:2000,candidatesTokenCount:100,totalTokenCount:2400}).thoughts,300);
 assert.equal(geminiUsage(null).costUsd,null);assert.equal(geminiUsage({promptTokenCount:-1,candidatesTokenCount:1}).costUsd,null);
 assert.equal(geminiUsage({promptTokenCount:10,candidatesTokenCount:1},'other-model').costUsd,null);
 const s=usageSummary([u,geminiUsage(null)]);assert.equal(s.providers.gemini.calls,2);assert.equal(s.unknownCalls,1);assert.equal(s.costUsd,u.costUsd);
});
test('재시도·무효 JSON도 사용량 기록, 같은 UUID 업데이트와 재조회·이전 판 표시',async()=>{
 const db=database(),originalFetch=globalThis.fetch;let calls=0;let g=apply(createGame(()=>.5),'human',{type:'START'});g.aiConfig={usageTrackingVersion:1};
 try{globalThis.fetch=async()=>{calls++;return Response.json({usageMetadata:{promptTokenCount:100,candidatesTokenCount:30,thoughtsTokenCount:20,totalTokenCount:150},candidates:[{content:{parts:[{text:calls===1?'bad json':JSON.stringify({type:'CHAT',text:'초안을 살펴볼게요.',speechAct:'ANSWER'})}]}}]});};
 await decide(g,{actor:'ai1',type:'CHAT'},'mock',null,{onUsage:r=>recordUsage(db,g,r)});let result=await gameUsage(db,g);assert.equal(result.records.length,2);assert.equal(result.summary.providers.gemini.input,200);assert.equal(result.summary.providers.gemini.thoughts,40);assert.equal(result.summary.unknownCalls,0);
 assert.equal(result.records[0].status,'ERROR');assert.equal(result.records[0].errorCode,'INVALID_JSON');
 await recordUsage(db,g,result.records[0]);assert.equal((await gameUsage(db,g)).records.length,2);
 delete g.aiConfig.usageTrackingVersion;assert.equal((await gameUsage(db,g)).summary.legacyIncomplete,true);
 globalThis.fetch=async()=>{throw Error('private-response')};await assert.rejects(decide(g,{actor:'ai1',type:'CHAT'},'mock',null,{onUsage:r=>recordUsage(db,g,r)}));
 result=await gameUsage(db,g);assert.equal(result.summary.unknownCalls,2);assert.ok(!JSON.stringify(result).includes('private-response'));
 }finally{globalThis.fetch=originalFetch;db.close();}
});
test('동시 요청은 판별 임대 하나만 허용, 만료와 소유자 확인 후 복구',async()=>{
 const db=database(),g={id:'test'};try{const owners=await Promise.all([acquireAiLease(db,g,100),acquireAiLease(db,g,100)]);assert.equal(owners.filter(Boolean).length,1);
 await releaseAiLease(db,g.id,'wrong-owner');assert.equal(await acquireAiLease(db,g,101),null);
 await releaseAiLease(db,g.id,owners.find(Boolean));assert.ok(await acquireAiLease(db,g,102));assert.ok(await acquireAiLease(db,g,180103));
 }finally{db.close();}
});
