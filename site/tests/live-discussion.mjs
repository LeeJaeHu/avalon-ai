import { readFileSync } from 'node:fs';
import { observe, observeModerator, NAMES } from '../lib/game.mjs';
import { roleClues, evilPosterior } from '../lib/belief.mjs';
import { buildPromptV2 } from '../lib/prompts/v2.mjs';
import { buildDiscussionPrompt } from '../lib/prompts/discussion.mjs';
import { responseSchema } from '../lib/response-schema.mjs';
import { AI_MODEL } from '../lib/ai.mjs';

// Explicitly authorized only. Direct fetch means no automatic retry.
const followup = process.env.AVALON_EVAL_MODE === 'followup';
const limit = followup ? 3 : 6;
if (process.env.AVALON_EVAL_LIMIT !== String(limit)) throw new Error('Explicit evaluation limit required');
const saved = JSON.parse(readFileSync(process.env.AVALON_EVAL_LOG,'utf8')).game;
const cases = [
  {id:'after-failed-quest',actor:'ai3',messages:4,quests:1,proposals:1,phase:'PROPOSE',team:null},
  {id:'how-to-narrow',actor:'ai4',messages:11,quests:2,proposals:3,phase:'VOTE_RESULT',reply:true},
  {id:'why-rejected',actor:'ai3',messages:16,quests:3,proposals:4,phase:'VOTE',reply:true},
];
let calls = 0;
const results = [];
for (const item of cases) {
  const game = structuredClone(saved);
  game.phase = item.phase; game.winner=null; game.paused=false;
  game.messages=game.messages.slice(0,item.messages); game.quests=game.quests.slice(0,item.quests);
  game.proposals=game.proposals.slice(0,item.proposals); game.quest=item.quests;
  game.team=item.team===null?null:game.proposals.at(-1).team; game.votes={}; game.cards={}; game.privateCards=[];
  if(item.phase==='VOTE') {game.proposals.at(-1).status='VOTING';delete game.proposals.at(-1).votes;delete game.proposals.at(-1).approveCount;}
  const view=observe(game,item.actor);
  const request={actor:item.actor,type:'CHAT',topic:'discussion',replyMessage:item.reply?{...game.messages.at(-1),name:NAMES[game.messages.at(-1).actor]}:null};
  const input={request,view,publicState:observeModerator(game),personalInfo:{id:item.actor,name:NAMES[item.actor],role:view.role,known:view.known,
    roleClues:roleClues(view,item.actor),evilBelief:evilPosterior(view,item.actor)}};
  for (const [variant,builder] of (followup ? [['revised',buildDiscussionPrompt]] : [['before',buildPromptV2],['after',buildDiscussionPrompt]])) {
    const started=Date.now();
    if(++calls>limit) throw new Error('Budget exhausted');
    try {
      const response=await fetch(process.env.AVALON_EVAL_URL,{method:'POST',headers:{'Content-Type':'application/json','x-avalon-proxy-token':process.env.AVALON_EVAL_TOKEN},
        body:JSON.stringify({contents:[{role:'user',parts:[{text:builder(input)}]}],generationConfig:{temperature:0.7,maxOutputTokens:768,responseMimeType:'application/json',responseSchema:responseSchema(request,view)}}),signal:AbortSignal.timeout(20000)});
      if(!response.ok) {results.push({case:item.id,variant,ok:false,http:response.status});continue;}
      const data=await response.json();
      const raw=data.candidates?.[0]?.content?.parts?.map(p=>p.text??'').join('')??'';
      const action=JSON.parse(raw.replace(/^\s*```(?:json)?\s*\n?/,'').replace(/\s*```\s*$/,''));
      results.push({case:item.id,variant,ok:action.type==='CHAT',type:action.type,text:action.type==='CHAT'?action.text:null,
        inputTokens:data.usageMetadata?.promptTokenCount,outputTokens:data.usageMetadata?.candidatesTokenCount,latencyMs:Date.now()-started});
    } catch(error) {results.push({case:item.id,variant,ok:false,error:error.name});}
  }
}
console.log(JSON.stringify({calls,model:AI_MODEL,policyVersion:'2026-10-01.8-candidate',promptVersion:'V2',temperature:0.7,results}));
