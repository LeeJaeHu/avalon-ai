import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, observe, observeModerator, IDS, SIZES } from '../lib/game.mjs';
import { nextAiAction } from '../lib/ai.mjs';

function seeded() { let i = 0; return () => [0.1,0.7,0.3,0.8,0.2][i++ % 5]; }
function fresh() { return apply(createGame(seeded()),'human',{type:'START'}); }
function voteAll(g, choices) { for (let i=0;i<5;i++) g=apply(g,IDS[i],{type:'VOTE',choice:choices[i]}); return g; }

test('역할 배정과 관찰 정보 경계', () => {
  const g=fresh();
  assert.deepEqual(Object.values(g.roles).sort(),['ASSASSIN','LOYAL','LOYAL','MERLIN','MINION'].sort());
  for(const id of IDS) {
    const v=observe(g,id);
    const evil=IDS.filter(x=>['ASSASSIN','MINION'].includes(g.roles[x]));
    if(g.roles[id]==='MERLIN') assert.deepEqual(v.known,evil);
    if(g.roles[id]==='LOYAL') assert.deepEqual(v.known,[]);
    if(evil.includes(id)) assert.deepEqual(v.known,evil.filter(x=>x!==id));
    assert.equal('roles' in v,false);
  }
  const mod=observeModerator(g);
  assert.equal('role' in mod,false);
  assert.equal('known' in mod,false);
});

test('사람과 AI 발언은 speechAct를 검증하고 메시지에 저장한다', () => {
  const g = fresh();
  assert.throws(() => apply(g, 'ai1', { type: 'CHAT', text: '왜 이 팀인가요?' }));
  assert.throws(() => apply(g, 'ai1', { type: 'CHAT', text: '왜 이 팀인가요?', speechAct: 'PROPOSE' }));
  const said = apply(g, 'ai1', { type: 'CHAT', text: '왜 이 팀인가요?', speechAct: 'QUESTION' });
  assert.equal(said.messages.at(-1).speechAct, 'QUESTION');
  assert.equal(said.messages.at(-1).actor, 'ai1');
  assert.equal(observeModerator(said).messages.at(-1).speechAct, 'QUESTION');
  assert.throws(() => apply(g, 'human', { type: 'CHAT', text: '저도 궁금해요.' }));
  const humanSaid = apply(g, 'human', { type: 'CHAT', text: '저도 궁금해요.', speechAct: 'ANSWER' });
  assert.equal(humanSaid.messages.at(-1).speechAct, 'ANSWER');
  assert.equal(humanSaid.messages.at(-1).actor, 'human');
});

test('역할 확인 전에는 사람과 AI 모두 게임을 진행할 수 없다', () => {
  const g=createGame(seeded());
  assert.equal(g.phase,'ROLE_REVEAL');
  assert.equal(observe(g).role,g.roles.human);
  assert.throws(()=>apply(g,'human',{type:'CHAT',text:'안녕'}));
  assert.throws(()=>apply(g,g.leader,{type:'PROPOSE',team:IDS.slice(0,2)}));
  assert.throws(()=>apply(g,'ai1',{type:'START'}));
  const started=apply(g,'human',{type:'START'});
  assert.equal(started.phase,'PROPOSE');
  assert.equal(started.version,1);
  assert.throws(()=>apply(started,'human',{type:'START'}));
});

test('일시정지는 진행 상태를 보존하고 재개 전 행동과 AI 진행을 막는다', () => {
  const g=fresh();
  const paused=apply(g,'human',{type:'PAUSE'});
  assert.equal(paused.phase,g.phase);
  assert.equal(observe(paused).paused,true);
  assert.equal(nextAiAction(paused),null);
  assert.throws(()=>apply(paused,'human',{type:'CHAT',text:'계속'}));
  assert.throws(()=>apply(paused,'ai1',{type:'RESUME'}));
  assert.throws(()=>apply(paused,'human',{type:'PAUSE'}));
  const resumed=apply(paused,'human',{type:'RESUME'});
  assert.equal(resumed.phase,g.phase);
  assert.equal(resumed.paused,false);
  assert.equal(resumed.version,paused.version+1);
  const old=structuredClone(g);
  delete old.paused;
  assert.equal(apply(old,'human',{type:'PAUSE'}).paused,true);
});

test('팀 크기, 비밀 투표, 5회 부결', () => {
  let g=fresh();
  assert.throws(()=>apply(g,g.leader,{type:'PROPOSE',team:IDS.slice(0,3)}));
  for(let attempt=1;attempt<=5;attempt++){
    g=apply(g,g.leader,{type:'PROPOSE',team:IDS.slice(0,SIZES[0])});
    g=apply(g,IDS[0],{type:'VOTE',choice:'REJECT'});
    assert.equal('votes' in observe(g).proposals.at(-1),false);
    g=voteRest(g,['REJECT','REJECT','APPROVE','APPROVE']);
    assert.equal(g.proposals.at(-1).status,'REJECTED');
    assert.equal(g.phase,'VOTE_RESULT');
    assert.equal(observe(g).proposals.at(-1).votes.length,5);
    assert.throws(()=>apply(g,'ai1',{type:'CONTINUE'}));
    g=apply(g,'human',{type:'CONTINUE'});
  }
  assert.equal(g.winner,'EVIL');
  assert.equal(g.phase,'ENDED');
});
function voteRest(g,choices){for(let i=1;i<5;i++)g=apply(g,IDS[i],{type:'VOTE',choice:choices[i-1]});return g;}

test('선의 실패 카드 금지와 실패 카드 제출자 비공개', () => {
  let g=fresh();
  const evil=IDS.find(id=>['ASSASSIN','MINION'].includes(g.roles[id]));
  const good=IDS.find(id=>['LOYAL','MERLIN'].includes(g.roles[id]));
  g=apply(g,g.leader,{type:'PROPOSE',team:[evil,good]});
  g=voteAll(g,['APPROVE','APPROVE','APPROVE','REJECT','REJECT']);
  assert.equal(g.phase,'VOTE_RESULT');
  assert.deepEqual(observe(g).proposals.at(-1).votes.map(v=>v.choice),['APPROVE','APPROVE','APPROVE','REJECT','REJECT']);
  g=apply(g,'human',{type:'CONTINUE'});
  assert.equal(g.phase,'QUEST');
  assert.throws(()=>apply(g,good,{type:'CARD',choice:'FAIL'}));
  g=apply(g,evil,{type:'CARD',choice:'FAIL'});
  assert.equal('cards' in observe(g),false);
  g=apply(g,good,{type:'CARD',choice:'SUCCESS'});
  assert.equal(g.phase,'QUEST_RESULT');
  assert.equal(g.quests[0].fails,1);
  assert.equal(g.quests[0].result,'FAIL');
  g=apply(g,'human',{type:'CONTINUE'});
  assert.equal(g.phase,'PROPOSE');
  assert.equal(JSON.stringify(observe(g)).includes('"cards"'),false);
  assert.equal(JSON.stringify(observe(g)).includes('"privateCards"'),false);
});

test('성공 3회 후 정확·오답 암살', () => {
  for(const correct of [true,false]){
    let g=fresh();
    for(let quest=0;quest<3;quest++){
      g=apply(g,g.leader,{type:'PROPOSE',team:IDS.slice(0,SIZES[quest])});
      g=voteAll(g,Array(5).fill('APPROVE'));
      assert.equal(g.phase,'VOTE_RESULT');
      g=apply(g,'human',{type:'CONTINUE'});
      for(const id of g.team)g=apply(g,id,{type:'CARD',choice:'SUCCESS'});
      assert.equal(g.phase,'QUEST_RESULT');
      assert.equal(g.quests.at(-1).result,'SUCCESS');
      g=apply(g,'human',{type:'CONTINUE'});
    }
    assert.equal(g.phase,'ASSASSINATE');
    const assassin=IDS.find(id=>g.roles[id]==='ASSASSIN');
    const merlin=IDS.find(id=>g.roles[id]==='MERLIN');
    const target=correct?merlin:IDS.find(id=>id!==assassin&&id!==merlin);
    g=apply(g,assassin,{type:'ASSASSINATE',target});
    assert.equal(g.winner,correct?'EVIL':'GOOD');
    assert.deepEqual(observe(g).roles,g.roles);
  }
});
