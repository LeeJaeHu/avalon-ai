import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,apply} from '../lib/game.mjs';
import {addressedQuestion,routeDiscussion,baselineDiscussion} from '../lib/discussion-routing.mjs';
import {rememberAction,voteExplanationContext} from '../lib/action-selection.mjs';
import {decide} from '../lib/ai.mjs';
import {compareModelLogs,COMPARISON_VERSION} from '../lib/comparison.mjs';
const fixture=()=>({...createGame(()=>.5),phase:'TEAM_DISCUSSION',aiConfig:{manualProgress:true,conversationVersion:1,routingMode:'jev'},roles:{human:'LOYAL',ai1:'MERLIN',ai2:'LOYAL',ai3:'ASSASSIN',ai4:'MINION'}});
test('진행 중 실행 버전이 바뀐 판은 모델 품질 비교에서 제외한다',()=>{
  const g={...fixture(),phase:'ENDED',winner:'GOOD',aiConfig:{model:'gemini-3.5-flash-lite',comparisonVersion:COMPARISON_VERSION,runtimeChanged:true}};
  const report=compareModelLogs([{format:'avalon-game-log-v1',game:g,modelUsage:[],events:[]}]);
  assert.equal(report.games[0].exclusion,'runtime-updated');assert.equal(report.byMode.gemini.completedGames,0);
});
test('하린에게 서아·도윤을 묻는 질문은 하린에게 전달하고 명시 답장이 우선한다',async()=>{
  const texts=['하린님은 이번에도 팀에 반대했는데, 서아, 도윤 중에 의심되는 플레이어가 있었던가요?','하린님, 서아가 의심되나요?','도윤아, 하린을 왜 넣었어?','서아, 왜 하린에게 반대했나요?'];
  for(const [i,text] of texts.entries()){
    const g=fixture();g.messages=[{id:'q',actor:'human',text}];
    const result=await routeDiscussion(g,{replyTo:'q'},{mode:'jev',key:'mock',fetchImpl:()=>assert.fail('명확한 수신자는 JEV 재선택 금지')});
    assert.equal(result.actor,['ai1','ai1','ai2','ai3'][i]);assert.equal(result.record.status,'ADDRESSED_QUESTION');
  }
  const g=fixture();g.messages=[{id:'a',actor:'ai4',text:'제 의견입니다.'},{id:'q',actor:'human',text:texts[0],replyTo:'a'}];
  const result=await routeDiscussion(g,{replyTo:'q'},{mode:'jev'});assert.equal(result.actor,'ai4');assert.equal(result.record.status,'EXPLICIT_REPLY');
});
test('단순 언급·인용·여러 사람 호명은 확정 수신자로 삼지 않는다',()=>{
  for(const text of ['하린은 빼는 게 어때요?','서아와 도윤 중 누가 의심되나요?','“하린님, 왜 반대했나요?”라고 물었어요.','하린, 서아 중 누구를 넣을까요?','하린님은 반대했습니다.'])assert.equal(addressedQuestion(text),null,text);
  const g=fixture();g.messages=[{id:'q',actor:'ai2',text:'하린님, 왜 반대했나요?'}];assert.equal(baselineDiscussion(g,{replyTo:'q'}).namedQuestion,false);
});
test('투표 시점 문맥은 미래 결과·타인 비공개 상태 없이 독립 저장한다',()=>{
  const before={...fixture(),phase:'VOTE',version:10,team:['ai1','ai3'],proposals:[{id:'p',quest:1,attempt:1,team:['ai1','ai3'],leader:'ai1',status:'VOTING',votes:[{actor:'ai3',choice:'REJECT'}]}],quests:[],messages:[{id:'m',actor:'ai1',text:'서아 대신 도윤을 넣고 싶어요.',version:8,thinking:'SECRET'}]};
  const decision={actor:'ai1',action:{type:'VOTE',choice:'REJECT'},mode:'jev'};
  const next=apply(before,'ai1',decision.action);rememberAction(next,decision,before);
  before.proposals[0].team.push('human');next.quests.push({id:'future',result:'FAIL',fails:2});
  const c=voteExplanationContext(next,'ai1');assert.deepEqual(c.recordedVotes[0].context.proposal.team,['ai1','ai3']);assert.deepEqual(c.recordedVotes[0].context.quests,[]);
  assert.equal(c.recordedVotes[0].context.reasonRecorded,false);assert.equal(c.publishedVotes.length,0);
  assert.ok(!/SECRET|MERLIN|ASSASSIN|future|"votes"/.test(JSON.stringify(c)));assert.equal(voteExplanationContext(next,'ai2').recordedVotes.length,0);
  next.privateActions.ai1.push({type:'VOTE',choice:'APPROVE',stateVersion:4});assert.equal(voteExplanationContext(next,'ai1').recordedVotes.at(-1).context,null);
});
test('실제 Gemini 요청은 본인 투표 설명 문맥과 기록 부재 지침을 포함한다',async()=>{
  const g=fixture();g.privateActions={ai1:[{type:'VOTE',choice:'REJECT',stateVersion:2}],ai2:[{type:'VOTE',choice:'APPROVE',stateVersion:99}]};
  g.messages=[{id:'q',actor:'human',text:'하린님, 왜 반대했나요?'}];
  const previous=globalThis.fetch;let prompt='';
  globalThis.fetch=async(_url,init)=>{prompt=JSON.parse(init.body).contents[0].parts[0].text;return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({type:'CHAT',text:'아직 특정인을 확신하진 못해요. 서아를 새로 넣은 이유부터 듣고 싶어요.',speechAct:'ANSWER',thinking:'검사',evidence:{summary:'검사',references:[],confidence:'LOW'}})}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10}});};
  try{await decide(g,{type:'CHAT',actor:'ai1',replyTo:'q',requiredResponse:true},'mock');assert.ok(prompt.includes('"voteExplanation"'));assert.ok(prompt.includes('"context":null'));assert.ok(prompt.includes('reasonRecorded=false'));assert.ok(!prompt.includes('"stateVersion":99'));}finally{globalThis.fetch=previous;}
});
