import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, observe, observeModerator, IDS, SIZES } from '../lib/game.mjs';

function seeded() { let i = 0; return () => [0.1,0.7,0.3,0.8,0.2][i++ % 5]; }
function fresh() { return createGame(seeded()); }
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

test('팀 크기, 비밀 투표, 5회 부결', () => {
  let g=fresh();
  assert.throws(()=>apply(g,g.leader,{type:'PROPOSE',team:IDS.slice(0,3)}));
  for(let attempt=1;attempt<=5;attempt++){
    g=apply(g,g.leader,{type:'PROPOSE',team:IDS.slice(0,SIZES[0])});
    g=apply(g,IDS[0],{type:'VOTE',choice:'REJECT'});
    assert.equal('votes' in observe(g).proposals.at(-1),false);
    g=voteRest(g,['REJECT','REJECT','APPROVE','APPROVE']);
    assert.equal(g.proposals.at(-1).status,'REJECTED');
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
  assert.equal(g.phase,'QUEST');
  assert.throws(()=>apply(g,good,{type:'CARD',choice:'FAIL'}));
  g=apply(g,evil,{type:'CARD',choice:'FAIL'});
  assert.equal('cards' in observe(g),false);
  g=apply(g,good,{type:'CARD',choice:'SUCCESS'});
  assert.equal(g.quests[0].fails,1);
  assert.equal(g.quests[0].result,'FAIL');
  assert.equal(JSON.stringify(observe(g)).includes('"cards"'),false);
  assert.equal(JSON.stringify(observe(g)).includes('"privateCards"'),false);
});

test('성공 3회 후 정확·오답 암살', () => {
  for(const correct of [true,false]){
    let g=fresh();
    for(let quest=0;quest<3;quest++){
      g=apply(g,g.leader,{type:'PROPOSE',team:IDS.slice(0,SIZES[quest])});
      g=voteAll(g,Array(5).fill('APPROVE'));
      for(const id of g.team)g=apply(g,id,{type:'CARD',choice:'SUCCESS'});
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
