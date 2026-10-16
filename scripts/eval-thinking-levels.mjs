import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createGame,apply,SPEECH_ACTS} from '../site/lib/game.mjs';
import {decide,PROMPT_VERSION} from '../site/lib/ai.mjs';
import {geminiUsage} from '../site/lib/usage.mjs';

// One authorized scene, four calls, no retries. Results stay in Git-ignored logs.
const levels=['MINIMAL','LOW','MEDIUM','HIGH'];
const questionCase=process.argv.includes('--question');
const both=process.argv.includes('--both');
assert.ok(!both||questionCase,'--both requires --question');
const flash=process.argv.includes('--flash');
const model=flash?'gemini-3.5-flash':'gemini-3.5-flash-lite',maxOutputTokens=8192,budgetUsd=both?.75:flash?.60:.15;
const models=both?['gemini-3.5-flash-lite','gemini-3.5-flash']:[model];
const source=process.argv[2];
if(!source)throw new Error('Usage: node scripts/eval-thinking-levels.mjs LOG [--run]');
const log=JSON.parse(readFileSync(source,'utf8'));
if(!questionCase){assert.equal(log.aiFailures[0]?.state_version,3);assert.equal(log.game.aiConfig.promptVersion,PROMPT_VERSION);}
let game=createGame(()=>.5,log.game.aiConfig.humanRoleMode);
Object.assign(game,{id:log.game.id,roles:log.game.roles,leader:log.game.proposals[0].leader,createdAt:log.game.createdAt,aiConfig:log.game.aiConfig});
if(questionCase){
 assert.equal(log.game.id,'79af8971-bc15-44cc-9bf6-fbbae1b12241');
 for(const event of log.events.filter(e=>e.version>0&&e.version<=57)){
  let action={type:event.type};
  if(event.type==='CHAT'){
   const message=log.game.messages.find(m=>m.at===event.at&&m.actor===event.actor);assert.ok(message);action={type:'CHAT',...message};
  }else if(event.type==='PROPOSE'){
   const proposal=log.game.proposals.find(p=>p.quest===game.quest+1&&p.attempt===game.attempt);assert.ok(proposal);action.team=proposal.team;
  }else if(event.type==='VOTE'){
   action.choice=log.game.proposals.find(p=>p.id===game.proposals.at(-1).id).votes.find(v=>v.actor===event.actor).choice;
  }else if(event.type==='CARD'){
   action.choice=log.game.privateCards.find(c=>c.quest===game.quest+1&&c.actor===event.actor).choice;
  }else if(event.type==='SILENCE'){action.idleTrigger=true;}
  game=apply(game,event.actor,action);assert.equal(game.version,event.version);
  if(event.type==='CHAT')game.messages[game.messages.length-1]=structuredClone(log.game.messages.find(m=>m.at===event.at&&m.actor===event.actor));
 }
 game.publicEvents=log.game.publicEvents.filter(e=>e.version<=57);
 game.privateActions=Object.fromEntries(Object.entries(log.game.privateActions).map(([actor,actions])=>[actor,actions.filter(a=>a.stateVersion<=57)]));
 game.privateThinking={};
 for(const event of log.events.filter(e=>e.version<=57&&typeof e.detail.thinking==='string')){
  const actor=event.detail.thinkingOwner;game.privateThinking[actor]={text:event.detail.thinking,stateVersion:event.version,requestType:'CHAT',at:event.at};
 }
 assert.equal(game.phase,'QUEST_RESULT');assert.equal(game.version,57);assert.equal(game.messages.at(-1).id,'msg-12');
 assert.deepEqual(game.quests,log.game.quests.slice(0,3));assert.equal(game.messages.length,12);
 assert.equal(game.privateActions.ai1.at(-1).stateVersion,48);
 assert.equal(game.privateThinking.ai1.stateVersion,42);
 assert.ok(game.publicEvents.every(e=>e.version<=57));
 assert.ok(!game.messages.some(m=>m.id==='msg-13'));assert.equal(game.winner,null);
}else{
game=apply(game,'human',{type:'START'});
const opening=log.game.messages[0];
game=apply(game,opening.actor,{type:'CHAT',text:opening.text,speechAct:opening.speechAct});
game=apply(game,game.leader,{type:'PROPOSE',team:log.game.proposals[0].team});
game.messages=[structuredClone(opening)];
game.publicEvents=log.game.publicEvents.filter(e=>e.version<=3);
assert.equal(game.version,3);
assert.equal(game.quests.length,0);
assert.equal(game.proposals[0].status,'DRAFT');
assert.equal(game.privateCards.length,0);
assert.equal(game.winner,null);
assert.equal(game.messages.length,1);
assert.equal(game.publicEvents.length,1);
}
const request=questionCase?{actor:'ai1',type:'CHAT',topic:'msg-12',replyTo:'msg-12',directReply:true,requiredResponse:'HUMAN_REPLY_REQUIRED'}:{actor:'ai2',type:'CHAT',topic:'proposal-1',replyTo:null,directReply:false,requiredResponse:null};
let captured;
const originalFetch=globalThis.fetch;
try{
 globalThis.fetch=async(_url,init)=>{captured=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({type:'CHAT',text:'팀의 근거를 먼저 확인하겠습니다.',speechAct:'QUESTION',thinking:'mock'})}]}}]});};
 await decide(game,request,'mock-only-key');
}finally{globalThis.fetch=originalFetch;}
assert.ok(captured.generationConfig.responseSchema.required.includes('thinking'));
const prompt=captured.contents[0].parts[0].text;
const bytes=Buffer.byteLength(prompt,'utf8');
assert.ok(bytes<=50000,'Input exceeds conservative budget reservation');
const reserveFor=model=>(50000*(model==='gemini-3.5-flash'?1.50:.30)+maxOutputTokens*(model==='gemini-3.5-flash'?9:2.50))/1e6;
assert.ok(models.reduce((sum,m)=>sum+reserveFor(m)*4,0)<budgetUsd);
const payload=level=>({contents:captured.contents,generationConfig:{...captured.generationConfig,maxOutputTokens,thinkingConfig:{thinkingLevel:level}}});
for(const level of levels){const p=payload(level);assert.equal(p.generationConfig.thinkingConfig.thinkingLevel,level);assert.equal(p.generationConfig.maxOutputTokens,maxOutputTokens);assert.deepEqual(p.contents,captured.contents);}
if(questionCase){assert.ok(prompt.includes('msg-12'));assert.ok(!prompt.includes('msg-13'));assert.ok(!prompt.includes('quest-4'));assert.ok(!prompt.includes('proposal-4'));assert.ok(prompt.includes('reasonRecorded'));}
const meta={model,models,levels,maxOutputTokens,budgetUsd,temperature:captured.generationConfig.temperature,promptVersion:PROMPT_VERSION,originalPromptVersion:log.game.aiConfig.promptVersion,sourceGameId:game.id,stateVersion:game.version,actor:request.actor,scene:questionCase?'addressed-suspicion-after-third-quest':'first-team-proposal',promptHash:createHash('sha256').update(prompt).digest('hex'),promptBytes:bytes,reconstruction:'engine replay; original messages/public-event timestamps and past own actions/thinking; original request payload unavailable; current prompt used',retries:0};
if(!process.argv.includes('--run')){console.log(JSON.stringify({check:'PASS',...meta}));process.exit(0);}
if(process.env.AVALON_EVAL_APPROVED!==`${models.length*4}-calls-${budgetUsd.toFixed(2)}-usd`)throw new Error('Explicit evaluation approval required');
const token=execFileSync('powershell.exe',['-NoProfile','-Command','gcloud auth print-access-token --quiet'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(!token)throw new Error('Google authentication unavailable');
const proxySource=readFileSync(new URL('../site/vertex-proxy/server.mjs',import.meta.url),'utf8');
const project=proxySource.match(/const project = '([^']+)'/)?.[1];
if(!project)throw new Error('Project unavailable');
const results=[];
const directory=new URL('../logs/evals-thinking-2026-10-07/',import.meta.url);mkdirSync(directory,{recursive:true});
const output=new URL(questionCase?'addressed-question-comparison.json':flash?'first-error-flash.json':'first-error-flash-lite.json',directory);
for(const model of models)for(const level of levels){
 const reserveUsd=reserveFor(model);
 const endpoint=`https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
 const spent=results.reduce((sum,r)=>sum+(r.usage?.costUsd??reserveFor(r.model)),0);
 if(spent+reserveUsd>budgetUsd)throw new Error('Budget reservation exceeded');
 const started=Date.now();let result={model,level};
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(payload(level)),signal:AbortSignal.timeout(60000)});
  if(!response.ok){result={...result,ok:false,httpStatus:response.status};}
  else{
   const data=await response.json();const candidate=data.candidates?.[0];
   const raw=candidate?.content?.parts?.filter(p=>!p.thought).map(p=>p.text??'').join('')??'';
   let action=null;try{action=JSON.parse(raw.replace(/^\s*```(?:json)?\s*\n?/,'').replace(/\s*```\s*$/,''));}catch{}
   const validChat=action?.type==='CHAT'&&typeof action.text==='string'&&action.text.trim().length>0&&action.text.length<=280&&SPEECH_ACTS.includes(action.speechAct);
   result={...result,ok:!!validChat&&candidate?.finishReason==='STOP',finishReason:candidate?.finishReason??null,responseChars:raw.length,action,usage:geminiUsage(data.usageMetadata,data.modelVersion??model),modelVersion:data.modelVersion??null};
  }
 }catch(error){result={...result,ok:false,error:error.name};}
 result.latencyMs=Date.now()-started;results.push(result);
 writeFileSync(output,JSON.stringify({...meta,executedAt:new Date().toISOString(),calls:results.length,results},null,2));
 console.log(JSON.stringify({...result,action:result.action?{type:result.action.type,text:result.action.text,speechAct:result.action.speechAct,thinkingChars:result.action.thinking?.length??0}:null}));
 if(result.httpStatus===401||result.httpStatus===403)break;
}
console.log(JSON.stringify({output:output.pathname,calls:results.length,costUsd:results.reduce((sum,r)=>sum+(r.usage?.costUsd??0),0),unknownCostCalls:results.filter(r=>r.usage?.costUsd==null).length}));
