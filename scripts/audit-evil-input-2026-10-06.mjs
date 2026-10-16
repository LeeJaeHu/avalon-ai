// Offline input audit: historical public fields reconstructed from the export;
// provider is mocked, so this does not measure model quality or exact original bytes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {decide} from '../site/.sites-runtime/roundtable-source/lib/ai.mjs';
const log=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const rows=[];
for(const [version,actor,type,phase,quest] of [[33,'ai2','CARD','QUEST',1],[37,'ai2','PROPOSE','PROPOSE',2],[46,'ai3','VOTE','VOTE',2],[54,'ai2','ASSASSINATE','ASSASSINATE',2]]){
 const event=log.events.find(e=>e.version===version);
 const game=structuredClone(log.game);
 Object.assign(game,{version:version-1,phase,quest,winner:null,assassination:null});
 game.messages=game.messages.filter(m=>m.at<event.at);
 game.publicEvents=game.publicEvents.filter(e=>e.version<version);
 game.quests=game.quests.filter(q=>game.publicEvents.some(e=>e.kind==='QUEST_RESULT'&&e.text.startsWith(`${Number(q.id.split('-')[1])}번째`)));
 game.proposals=game.proposals.filter(p=>game.publicEvents.some(e=>e.kind==='TEAM'&&e.version===[3,21,37][Number(p.id.split('-')[1])-1]));
 game.privateCards=game.privateCards.slice(0,log.events.filter(e=>e.version<version&&e.type==='CARD').length);
 game.team=type==='PROPOSE'?null:game.proposals.at(-1).team;
 game.leader=type==='PROPOSE'?actor:game.proposals.at(-1).leader;
 game.votes={};game.cards={};game.privateThinking={};
 const voteStart=game.publicEvents.findLast(e=>e.kind==='VOTE_START')?.version??Infinity;
 for(const e of log.events.filter(e=>e.version>voteStart&&e.version<version&&e.type==='VOTE'))game.votes[e.actor]=log.game.proposals[quest].votes.find(v=>v.actor===e.actor).choice;
 if(type==='VOTE'){game.proposals.at(-1).status='VOTING';delete game.proposals.at(-1).votes;delete game.proposals.at(-1).approveCount;}
 for(const e of log.events.filter(e=>e.version<version&&e.detail?.thinking))game.privateThinking[e.actor]={text:e.detail.thinking,stateVersion:e.version,requestType:e.type,at:e.at};
 let prompt, schema;
 globalThis.fetch=async (_url,options)=>{
  const body=JSON.parse(options.body);prompt=body.contents[0].parts[0].text;schema=body.generationConfig.responseSchema;
  const action={type,thinking:'offline audit',evidence:{summary:'offline audit',references:[],confidence:'LOW'},...(type==='CARD'?{choice:'FAIL'}:type==='PROPOSE'?{team:['ai2','ai1']}:type==='VOTE'?{choice:'REJECT'}:{target:'ai4'})};
  return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(action)}]}}]}),{status:200});
 };
 const decision=await decide(game,{actor,type},'offline-placeholder');
 const publicState=JSON.parse(prompt.split('공개 정보는 다음과 같습니다.')[1].trim().split('\n')[0]);
 const personal=JSON.parse(prompt.split('당신에 대한 정보는 다음과 같습니다.')[1].trim().split('\n')[0]);
 const request=JSON.parse(prompt.split('이번 요청은 다음과 같습니다.')[1].trim().split('\n')[0]);
 assert.equal(personal.role,log.game.roles[actor]);
 assert.deepEqual(personal.known,[actor==='ai2'?'ai3':'ai2']);
 assert.deepEqual(publicState.messages,game.messages);
 assert.equal(publicState.quest,quest+1);
 assert.equal(decision.mode,'gemini');
 const actual=type==='CARD'?log.game.privateCards.find(c=>c.quest===2&&c.actor===actor).choice:type==='PROPOSE'?log.game.proposals[2].team:type==='VOTE'?log.game.proposals[2].votes.find(v=>v.actor===actor).choice:log.game.assassination;
 const example=type==='PROPOSE'?request.outputExample.team:type==='ASSASSINATE'?request.outputExample.target:request.outputExample.choice;
 rows.push({version,actor,type,role:personal.role,known:personal.known,humanName:publicState.names.human,quest:publicState.quest,successes:publicState.quests.filter(q=>q.result==='SUCCESS').length,team:publicState.team,currentTeamEvilShares:personal.roleClues.currentTeamEvilShares,evilProbability:personal.evilBelief.evilProbability,messageCount:publicState.messages.length,previousThinkingPresent:!!personal.previousThinking,example,actual,exampleMatchesActual:JSON.stringify(example)===JSON.stringify(actual),alternativeAllowedBySchema:type==='CARD'?schema.properties.choice.enum.includes('FAIL'):type==='VOTE'?schema.properties.choice.enum.includes('REJECT'):true,alternativeReturnedUnchanged:type==='CARD'?decision.action.choice==='FAIL':type==='VOTE'?decision.action.choice==='REJECT':type==='PROPOSE'?decision.action.team.includes('ai2'):decision.action.target==='ai4'});
}
assert(rows.every(r=>r.exampleMatchesActual&&r.alternativeAllowedBySchema&&r.alternativeReturnedUnchanged));
console.log(JSON.stringify({method:'offline reconstruction and mocked provider; not an original request dump or model evaluation',cases:rows},null,2));
