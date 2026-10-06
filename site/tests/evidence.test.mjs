import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceReferenceIds, normalizeEvidence, loggedDecisionEvidence } from '../lib/evidence.mjs';
import { createGame, apply, observe, observeModerator } from '../lib/game.mjs';
import { decide } from '../lib/ai.mjs';
import { gameLog } from '../lib/game-log.mjs';

test('근거 출처는 제공한 기록과 본인 정보에 한정하고 잘못된 근거는 폐기한다', () => {
  const ids = evidenceReferenceIds({messages:[{id:'m1'}],proposals:[{id:'p1'}]}, {known:['ai4']});
  assert.deepEqual(ids,['p1','m1','self-role','known-players']);
  const evidence = {summary:' 짧은 설명 ',references:['m1','m1'],confidence:'LOW',thinking:'secret'};
  assert.deepEqual(normalizeEvidence(evidence,ids),{status:'RECORDED',summary:'짧은 설명',references:['m1'],confidence:'LOW'});
  assert.deepEqual(normalizeEvidence(null,ids),{status:'MISSING'});
  for(const value of [{...evidence,references:['made-up']},{...evidence,summary:'x'.repeat(241)},{...evidence,confidence:'CERTAIN'}])
    assert.deepEqual(normalizeEvidence(value,ids),{status:'INVALID'});
});

test('모의 암살 근거는 행동·공개 상태·다음 프롬프트에서 분리되고 누락 때문에 재시도하지 않는다', async () => {
  const previous = globalThis.fetch;
  const game = createGame(() => 0.5);
  game.phase='ASSASSINATE'; game.roles={human:'MERLIN',ai1:'ASSASSIN',ai2:'LOYAL',ai3:'LOYAL',ai4:'MINION'};
  const request={actor:'ai1',type:'ASSASSINATE'};
  let calls=0;
  try {
    for(const evidence of [{summary:'PRIVATE_EVIDENCE_MARKER',references:['self-role'],confidence:'LOW'},undefined,{summary:'bad',references:['fiction'],confidence:'HIGH'}]) {
      globalThis.fetch=async (_url,options) => {
        calls++;
        assert.ok(!options.body.includes('PRIVATE_EVIDENCE_MARKER'));
        assert.ok(!options.body.includes('PRIVATE_THINKING_MARKER'));
        return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({type:'ASSASSINATE',target:'human',thinking:'PRIVATE_THINKING_MARKER',evidence})}]}}]})};
      };
      const decision=await decide(game,request,'mock-key');
      assert.deepEqual(decision.action,{type:'ASSASSINATE',target:'human'});
      assert.equal(decision.evidence.status,evidence?.summary==='bad'?'INVALID':evidence?'RECORDED':'MISSING');
      const ended=apply(game,decision.actor,decision.action);
      assert.equal(ended.phase,'ENDED');
      for(const value of [ended,observe(ended),observeModerator(ended)]) assert.ok(!JSON.stringify(value).includes('PRIVATE_EVIDENCE_MARKER'));
      assert.equal(decision.thinking,'PRIVATE_THINKING_MARKER');
          assert.ok(!JSON.stringify(decision.action).includes('PRIVATE_THINKING_MARKER'));
      assert.deepEqual(loggedDecisionEvidence(decision),decision.evidence);
    }
    assert.equal(calls,3);
  } finally {globalThis.fetch=previous;}
});

test('기본 규칙 암살은 모델 추론으로 기록하지 않는다', () => {
  const evidence=loggedDecisionEvidence({mode:'fallback',action:{type:'ASSASSINATE',target:'human'}});
  assert.equal(evidence.status,'NOT_MODEL');
  assert.equal(evidence.source,'fallback');
  assert.ok(evidence.summary.includes('첫 후보'));
});

test('종료 로그는 비공개 사건에 저장한 근거를 다운로드·동기화 형식으로 보존한다', async () => {
  const evidence={status:'RECORDED',summary:'증거가 부족한 추측',references:[],confidence:'LOW'};
  const db={prepare(sql){return {bind(){return {async all(){return {results:sql.includes('FROM events')?[{version:10,actor:'ai1',type:'ASSASSINATE',detail:JSON.stringify({evidence})}]:[]};}};}};}};
  const log=await gameLog(db,{id:'ended-game',phase:'ENDED'});
  assert.equal(log.format,'avalon-game-log-v1');
  assert.deepEqual(log.events[0].detail.evidence,evidence);
});
