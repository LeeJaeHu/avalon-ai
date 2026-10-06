import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, observe, IDS } from '../lib/game.mjs';
import { nextAiAction, decide } from '../lib/ai.mjs';

function draft(leader='human') {
  let game=createGame(()=>0.5);
  game.leader=leader;
  game=apply(game,'human',{type:'START'});
  return apply(game,leader,{type:'PROPOSE',team:['human','ai1']});
}

test('토론 중 투표를 막고 리더만 같은 제안의 초안을 수정한다',()=>{
  let game=draft();
  assert.equal(game.phase,'TEAM_DISCUSSION');
  assert.equal(observe(game).proposals.at(-1).status,'DRAFT');
  for(const actor of IDS) assert.throws(()=>apply(game,actor,{type:'VOTE',choice:'APPROVE'}));
  assert.throws(()=>apply(game,'ai2',{type:'PROPOSE',team:['ai2','ai3']}));
  assert.throws(()=>apply(game,'human',{type:'PROPOSE',team:['human','human']}));
  game=apply(game,'human',{type:'PROPOSE',team:['human','ai3']});
  assert.equal(game.proposals.length,1);
  assert.equal(game.attempt,1);
  assert.equal(game.publicEvents.length,2);
  assert.deepEqual(observe(game).team,['human','ai3']);
  assert.throws(()=>apply(game,'ai1',{type:'START_VOTE'}));
  game=apply(game,'human',{type:'START_VOTE'});
  assert.equal(game.phase,'VOTE');
  assert.equal(nextAiAction(game).type,'VOTE');
  assert.throws(()=>apply(game,'human',{type:'PROPOSE',team:['human','ai1']}));
  assert.throws(()=>apply(game,'human',{type:'START_VOTE'}));
});

test('AI 초안은 토론 후 자동 투표하지 않고 재검토/실패 대체/정지 경계를 유지한다',async()=>{
  let game=draft('ai1');
  const speech=await decide(game,nextAiAction(game),null);
  game=apply(game,speech.actor,speech.action);
  assert.equal(nextAiAction(game),null);
  assert.notEqual(nextAiAction(game,Date.now()+10000)?.type,'VOTE');
  game=apply(game,'human',{type:'REQUEST_REVISION'});
  assert.deepEqual(nextAiAction(game),{actor:'ai1',type:'PROPOSE'});
  assert.throws(()=>apply(game,'human',{type:'REQUEST_REVISION'}));
  assert.throws(()=>apply(game,'human',{type:'START_VOTE'}));
  const paused=apply(game,'human',{type:'PAUSE'});
  assert.equal(nextAiAction(paused),null);
  assert.throws(()=>apply(paused,'human',{type:'START_VOTE'}));
  game=apply(paused,'human',{type:'RESUME'});
  // API 필수 행동 실패 대체 경로에서 사용하는 기존 키 없는 결정기를 검사한다.
  const fallback=await decide(game,nextAiAction(game),null);
  game=apply(game,fallback.actor,fallback.action);
  assert.equal(game.revisionRequested,false);
  assert.equal(game.proposals.length,1);
  game=apply(game,'human',{type:'CHAT',text:'도윤, 이 팀에서 바꿀 사람은?',speechAct:'QUESTION'});
  assert.equal((await decide(game,nextAiAction(game),null)).actor,'ai2');
});

test('공개 사건은 전원 투표 결과만 포함하며 개별 임무 카드와 역할을 노출하지 않는다',()=>{
  let game=apply(draft(),'human',{type:'START_VOTE'});
  for(const id of IDS.slice(0,4))game=apply(game,id,{type:'VOTE',choice:'APPROVE'});
  assert.equal(game.publicEvents.some(e=>e.kind==='VOTE_RESULT'),false);
  assert.equal('votes' in observe(game).proposals.at(-1),false);
  game=apply(game,'ai4',{type:'VOTE',choice:'REJECT'});
  assert.match(game.publicEvents.at(-1).text,/찬성 4명/);
  assert.equal(game.publicEvents.at(-1).kind,'VOTE_RESULT');
  game=apply(game,'human',{type:'CONTINUE'});
  game=apply(game,'human',{type:'CARD',choice:'SUCCESS'});
  assert.equal(game.publicEvents.some(e=>e.kind==='QUEST_RESULT'),false);
  game=apply(game,'ai1',{type:'CARD',choice:'SUCCESS'});
  assert.equal(game.phase,'QUEST_RESULT');
  assert.match(game.publicEvents.at(-1).text,/실패 카드 0장/);
  assert.ok(game.publicEvents.every(e=>Object.keys(e).sort().join(',')==='at,id,kind,text,version'));
  const publicText=JSON.stringify(observe(game).publicEvents);
  for(const field of ['roles','privateCards','MERLIN','ASSASSIN','MINION','LOYAL'])assert.equal(publicText.includes(field),false);
  assert.equal(nextAiAction(game),null);
  game=apply(game,'human',{type:'CHAT',text:'하린, 성공한 팀은 어떻게 봐?',speechAct:'QUESTION'});
  assert.equal(nextAiAction(game).type,'DISCUSS');
});

test('이전 저장 상태는 공개 사건 필드 없이도 투표와 결과를 이어간다',()=>{
  let game=apply(draft(),'human',{type:'START_VOTE'});
  delete game.publicEvents;
  delete game.revisionRequested;
  assert.deepEqual(observe(game).publicEvents,[]);
  for(const id of IDS)game=apply(game,id,{type:'VOTE',choice:'REJECT'});
  assert.equal(game.phase,'VOTE_RESULT');
  assert.equal(game.publicEvents.length,1);
  game=apply(game,'human',{type:'CONTINUE'});
  assert.equal(game.phase,'PROPOSE');
});

test('B 충신도 명시적 재검토에서는 대화 문맥을 받은 모델로 팀을 다시 판단한다',async()=>{
  let game=draft('ai1');
  game.roles.ai1='LOYAL';
  game.aiConfig={proposalPolicy:'B'};
  game=apply(game,'system',{type:'SILENCE'});
  game=apply(game,'human',{type:'REQUEST_REVISION'});
  const originalFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(_url,options)=>{
    calls++;
    assert.match(JSON.stringify(JSON.parse(options.body)),/revisionRequested/);
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({type:'PROPOSE',team:['ai1','ai3']})}]}}]})};
  };
  try{
    const result=await decide(game,nextAiAction(game),'mock-only-key');
    assert.equal(result.mode,'gemini');assert.equal(calls,1);
    assert.deepEqual(apply(game,result.actor,result.action).team,['ai1','ai3']);
  }finally{globalThis.fetch=originalFetch;}
});

test('답하기로 선택한 AI에게 이름이나 2인칭 표현 없이도 질문을 전달한다',async()=>{
  let game=draft();
  game=apply(game,'ai1',{type:'CHAT',text:'저는 이 팀에 찬성합니다.',speechAct:'OTHER'});
  const replyTo=game.messages.at(-1).id;
  game=apply(game,'ai2',{type:'CHAT',text:'다른 구성을 생각해 봅시다.',speechAct:'OTHER'});
  game=apply(game,'human',{type:'CHAT',text:'그 근거는 뭐야?',speechAct:'QUESTION',replyTo});
  const result=await decide(game,nextAiAction(game),null);
  assert.equal(result.actor,'ai1');
  assert.equal(result.action.replyTo,game.messages.at(-1).id);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(_url,options)=>{
    const prompt=JSON.parse(options.body).contents[0].parts[0].text;
    assert.ok(prompt.includes('"actor":"ai1"'));
    assert.ok(prompt.includes(`"replyTo":"${replyTo}"`));
    assert.ok(prompt.includes('그 근거는 뭐야?'));
    assert.ok(prompt.includes('저는 이 팀에 찬성합니다.'));
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({type:'CHAT',text:'첫 팀의 결과를 보고 판단하겠습니다.',speechAct:'ANSWER'})}]}}]})};
  };
  try{
    const response=await decide(game,nextAiAction(game),'mock-only-key');
    assert.equal(response.actor,'ai1');
    assert.equal(response.mode,'gemini');
  }finally{globalThis.fetch=originalFetch;}
});
