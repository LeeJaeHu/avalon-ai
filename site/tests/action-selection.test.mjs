import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, IDS, observeModerator } from '../lib/game.mjs';
import { actionPayload, selectAction, rememberAction, ownActions, teamCombinations } from '../lib/action-selection.mjs';
import { decide } from '../lib/ai.mjs';
import { rememberThinking } from '../lib/thinking-memory.mjs';
import { routingPayload, routeDiscussion, JEV_MODEL } from '../lib/discussion-routing.mjs';
const fixture = () => ({ ...createGame(()=>.5), phase:'PROPOSE', leader:'ai1', aiConfig:{conversationVersion:1,manualProgress:true,actionMode:'jev',routingMode:'jev',proposalPolicy:'B'},
  roles:{human:'LOYAL',ai1:'MERLIN',ai2:'LOYAL',ai3:'ASSASSIN',ai4:'MINION'} });
const answer = (keys, selected) => ({model:JEV_MODEL,usage:{input_tokens:1200},answers:{action:{type:'choice',choice:selected,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===selected?1:0]))}}});

test('네 행동은 Gemini 사전 호출 없이 JEV 선택을 적용하고 선 카드는 호출 없이 성공한다',async()=>{
  for(const [type,actor,phase,selected] of [['PROPOSE','ai1','PROPOSE','team-1'],['VOTE','ai2','VOTE','REJECT'],['CARD','ai4','QUEST','FAIL'],['ASSASSINATE','ai3','ASSASSINATE','ai1']]){
    const g={...fixture(),phase,team:['ai2','ai4']};let calls=0;const ledger=[];
    const d=await decide(g,{type,actor},'gemini-key-must-not-be-used',null,{key:'jev-mock',fetchImpl:async(url,init)=>{
      calls++;assert.ok(url.includes('typesafe'));const p=JSON.parse(init.body);assert.ok(init.signal);return Response.json(answer(Object.keys(p.questions.action.criteria),selected));
    },onUsage:r=>ledger.push(r)});
    assert.equal(calls,1);assert.equal(d.mode,'jev');assert.equal(d.selection.selected,selected);assert.equal(d.thinking,undefined);
    const next=apply(g,actor,d.action);rememberAction(next,d);assert.equal(ownActions(next,actor).at(-1).type,type);
    assert.equal(ledger.length,2);assert.equal(ledger.at(-1).input,1200);assert.ok(Math.abs(ledger.at(-1).costUsd-.0000504)<1e-12);
  }
  const g={...fixture(),phase:'QUEST',team:['ai1','ai2']};
  const d=await decide(g,{type:'CARD',actor:'ai2'},'mock',null,{key:'mock',fetchImpl:()=>assert.fail('선 카드 모델 호출 금지')});
  assert.equal(d.mode,'rule');assert.equal(d.action.choice,'SUCCESS');assert.equal(d.selection.status,'RULE');
});

test('20개 공개 채팅·자기 생각과 행동만 전달하고 비공개 표·타인의 카드·생각·사용자 추측은 제외한다',()=>{
  const g=fixture();g.phase='VOTE';g.team=['ai1','ai2'];
  g.messages=Array.from({length:25},(_,i)=>({id:`m${i}`,actor:'ai2',text:`발언${i}`,replyTo:null,thinking:'SECRET_MESSAGE'}));
  g.privateThinking={ai1:{text:'MY_THOUGHT',stateVersion:4,requestType:'CHAT'},ai2:{text:'SECRET_OTHER_THOUGHT'}};
  g.privateActions={ai1:[{type:'VOTE',choice:'REJECT',stateVersion:3,source:'jev'}],ai2:[{secret:'SECRET_OTHER_ACTION'}]};
  g.privateCards=[{actor:'ai1',quest:1,choice:'SUCCESS'},{actor:'ai2',quest:1,choice:'SECRET_CARD'}];
  g.votes={ai2:'SECRET_VOTE'};g.roleGuess={guesses:{ai1:'SECRET_HUMAN_GUESS'}};
  g.proposals=[{id:'p1',status:'VOTING',team:g.team,votes:[{actor:'ai2',choice:'SECRET_VOTE'}]}];
  const p=actionPayload(g,{type:'VOTE',actor:'ai1'}).payload;
  assert.equal(p.state.public.messages.length,20);assert.equal(p.state.public.messages[0].id,'m5');assert.equal(p.state.self.previousThinking.text,'MY_THOUGHT');
  assert.equal(p.state.self.previousActions[0].choice,'REJECT');assert.equal(p.state.self.ownCards.length,1);assert.deepEqual(p.state.self.known,['ai3','ai4']);
  assert.ok(!JSON.stringify(p).includes('SECRET_'));assert.ok(!Object.hasOwn(p.state.public,'roles'));
  const r=routingPayload(g,{type:'DISCUSS',replyTo:'m24'});assert.ok(!r.questions.speechAct);assert.ok(!JSON.stringify(r).includes('MY_THOUGHT'));assert.ok(!Object.hasOwn(observeModerator(g),'roleGuess'));
});

test('빈 키·HTTP·시간초과·잘못된 선택/확률/모델/사용량은 한 번 뒤 합법 기본 행동으로 대체한다',async()=>{
  const g={...fixture(),phase:'VOTE',team:['ai1','ai2']}, request={type:'VOTE',actor:'ai2'};
  const cases=[()=>({ok:false,status:429}),()=>{throw Object.assign(Error('SECRET_ERROR'),{name:'TimeoutError'});},()=>Response.json({}),
    ()=>{const a=answer(['APPROVE','REJECT'],'APPROVE');a.answers.action.choice='ILLEGAL';return Response.json(a);},
    ()=>{const a=answer(['APPROVE','REJECT'],'APPROVE');a.answers.action.probabilities.REJECT=1;return Response.json(a);},
    ()=>{const a=answer(['APPROVE','REJECT'],'APPROVE');a.model='wrong';return Response.json(a);},
    ()=>{const a=answer(['APPROVE','REJECT'],'APPROVE');a.usage.input_tokens=-1;return Response.json(a);}];
  for(const f of cases){let calls=0;const d=await decide(g,request,'gemini-never',null,{key:'mock',fetchImpl:async()=>{calls++;return f();}});
    assert.equal(calls,1);assert.equal(d.mode,'fallback');assert.equal(d.selection.status,'FALLBACK');assert.ok(!JSON.stringify(d).includes('SECRET_'));assert.doesNotThrow(()=>apply(g,request.actor,d.action));}
  const d=await decide(g,request,'gemini-never');assert.equal(d.mode,'fallback');assert.equal(d.selection.status,'NO_KEY');
});

test('5인/7인 팀 후보는 모든 합법 조합이며 JEV 라우터는 의도 분류 없이 응답을 처리한다',async()=>{
  assert.equal(teamCombinations(IDS,2).length,10);for(const [n,count] of [[2,21],[3,35],[4,35]])assert.equal(teamCombinations(['a','b','c','d','e','f','g'],n).length,count);
  const g=fixture();g.phase='TEAM_DISCUSSION';g.pendingDiscussion='followup';g.messages=[{id:'m',actor:'ai1',text:'다른 의견은?',replyTo:null}];
  const result=await routeDiscussion(g,{type:'DISCUSS',replyTo:'m'},{mode:'jev',key:'mock',fetchImpl:async(url,init)=>{
    assert.deepEqual(Object.keys(JSON.parse(init.body).questions),['responder']);return Response.json({model:JEV_MODEL,usage:{input_tokens:100},answers:{responder:{type:'choice',choice:'WAIT',confidence:1,probabilities:{ai1:0,ai2:0,ai3:0,ai4:0,WAIT:1}}}});
  }});assert.equal(result.record.status,'OK');assert.equal(result.actor,'WAIT');
});

test('Gemini 대화는 실제 JEV 선택과 본인 생각을 입력받고 새 thinking을 기록한다',async()=>{
  const g={...fixture(),phase:'VOTE',team:['ai1','ai2']}, choice={actor:'ai2',action:{type:'VOTE',choice:'REJECT'},mode:'jev'};
  const next=apply(g,'ai2',choice.action);rememberAction(next,choice);next.privateThinking={ai2:{text:'이전 자기 생각',stateVersion:0,requestType:'CHAT'}};
  const original=globalThis.fetch;try{globalThis.fetch=async(url,init)=>{assert.ok(!url.includes('typesafe'));const prompt=JSON.parse(init.body).contents[0].parts[0].text;
    assert.ok(prompt.includes('previousActions'));assert.ok(prompt.includes('REJECT'));assert.ok(prompt.includes('이전 자기 생각'));
    return Response.json({usageMetadata:{promptTokenCount:200,candidatesTokenCount:50},candidates:[{content:{parts:[{text:JSON.stringify({type:'CHAT',text:'저는 앞서 이 팀에 반대했습니다.',speechAct:'ANSWER',thinking:'팀 위험을 다시 판단한다.'})}]}}]});};
    const d=await decide(next,{type:'CHAT',actor:'ai2'},'mock');const after=apply(next,d.actor,d.action);rememberThinking(after,d);assert.equal(after.privateThinking.ai2.text,'팀 위험을 다시 판단한다.');
  }finally{globalThis.fetch=original;}
});
