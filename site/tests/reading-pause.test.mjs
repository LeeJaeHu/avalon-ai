import test from 'node:test';
import assert from 'node:assert/strict';
import {readingPauseAction} from '../lib/reading-pause.mjs';
import {createGame,apply,observe} from '../lib/game.mjs';

test('읽기·입력 중 자동 정지, 둘 다 종료하면 자동 재개하며 수동 정지는 보존한다',()=>{
  const view={conversationVersion:1,phase:'TEAM_DISCUSSION',paused:false};
  for(const [scroll,draft] of [[true,false],[false,true],[true,true]]){
    assert.deepEqual(readingPauseAction(view,scroll||draft),{type:'PAUSE',readingAuto:true});
    assert.equal(readingPauseAction({...view,paused:true,pauseSource:'reading'},scroll||draft),null);
  }
  assert.deepEqual(readingPauseAction({...view,paused:true,pauseSource:'reading'},false),{type:'RESUME',readingAuto:true});
  assert.equal(readingPauseAction({...view,paused:true,pauseSource:'manual'},false),null);
  assert.equal(readingPauseAction(view,true,true),null);
  assert.equal(readingPauseAction({...view,conversationVersion:undefined},true),null);
  for(const phase of ['ROLE_REVEAL','ENDED'])assert.equal(readingPauseAction({...view,phase},true),null);
});

test('자동 정지·재개는 마감 시간을 보존하고 중복 요청과 수동 정지 경쟁에 안전하다',()=>{
  let g=createGame(()=>.5);g.aiConfig={routingMode:'jev',conversationVersion:1};g=apply(g,'human',{type:'START'});
  g.conversation.continueAt=Date.now()+8000;
  const deadline=g.conversation.continueAt;
  g=apply(g,'human',{type:'PAUSE',readingAuto:true});
  assert.equal(observe(g).pauseSource,'reading');
  assert.equal(apply(g,'human',{type:'PAUSE',readingAuto:true}),g);
  g.pausedAt-=30000;
  g=apply(g,'human',{type:'RESUME',readingAuto:true});
  assert.ok(g.conversation.continueAt>=deadline+30000);
  assert.equal(g.paused,false);
  assert.equal(apply(g,'human',{type:'RESUME',readingAuto:true}),g);
  g=apply(g,'human',{type:'PAUSE'});
  assert.equal(observe(g).pauseSource,'manual');
  assert.equal(apply(g,'human',{type:'RESUME',readingAuto:true}),g);
  assert.equal(apply(g,'human',{type:'PAUSE',readingAuto:true}),g);
});
