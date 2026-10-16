// Run from an isolated copy of site. Local Worker/D1/synthetic Gemini only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createGame, apply } from '../lib/game.mjs';
import { ASSESSMENT_VERSION } from '../lib/event-assessment.mjs';
import { newGameGeminiGeneration } from '../lib/gemini-models.mjs';

assert.ok(process.cwd().includes('event-assessment-qa'), 'Use isolated event-assessment-qa checkout.');
const base = 'http://127.0.0.1:5199', proxyPort = 9931;
const stateDir = path.resolve(`.sites-runtime/assessment-api-state-${Date.now()}`);
const sqlFile = path.resolve('.sites-runtime/assessment-api.sql');
await mkdir(path.dirname(sqlFile), { recursive: true });
const sql = async text => {
  await writeFile(sqlFile, text);
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', stateDir, '--file', sqlFile], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};
await sql((await Promise.all(['0000_abandoned_shadow_king.sql', '0001_burly_dracula.sql', '0002_conversation_usage.sql'].map(f => readFile(`drizzle/${f}`, 'utf8')))).join('\n'));
let calls = 0, failNext = false, releaseResponse, requestArrived;
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw); calls++;
  assert.equal(input.generationConfig.responseSchema.properties.type.enum[0], 'THINK');
  if (requestArrived) { const signal = requestArrived; requestArrived = null; signal(); await new Promise(resolve => { releaseResponse = resolve; }); }
  if (failNext) { failNext = false; res.writeHead(503); res.end(); return; }
  const assessment = { situation: '모의 상황', advantage: 'UNCERTAIN', basis: '공개 팀 확인', speechPlan: '팀 선정 이유 질문', nextAction: '근거 확인 후 투표' };
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ modelVersion: input.model, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30 }, candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'THINK', assessment }) }] } }] }));
});
await new Promise(resolve => server.listen(proxyPort, '127.0.0.1', resolve));
const worker = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', stateDir, '--ip', '127.0.0.1', '--port', '5199', '--inspector-port', '0', '--var', `VERTEX_PROXY_URL:http://127.0.0.1:${proxyPort}`, '--var', 'VERTEX_PROXY_TOKEN:synthetic-only'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; worker.stdout.on('data', d => { output = (output + d).slice(-4000); }); worker.stderr.on('data', d => { output = (output + d).slice(-4000); });
const escapeSql = text => text.replaceAll("'", "''");
function setup() {
  let game = createGame(() => .5); game.leader = 'human';
  game.aiConfig = { model: 'gemini-3.5-flash-lite', ...newGameGeminiGeneration('gemini-3.5-flash-lite'), assessmentVersion: ASSESSMENT_VERSION, manualProgress: true, conversationVersion: 1, routingMode: 'baseline' };
  game = apply(game, 'human', { type: 'START' });
  return apply(game, 'human', { type: 'PROPOSE', team: ['human', 'ai1'] });
}
const seed = async game => sql(`INSERT INTO games(id,version,state,created_at,updated_at) VALUES('${game.id}',${game.version},'${escapeSql(JSON.stringify(game))}','${game.createdAt}','${game.createdAt}');`);
const request = (game, body) => fetch(base + '/api/game', { method: body ? 'POST' : 'GET', headers: { cookie: `avalon_game=${game.id}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify({ ...body, version: game.version }) } : {}) });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    assert.equal(worker.exitCode, null, output);
    try { if (output.includes('http://127.0.0.1:5199') && (await fetch(base + '/api/game')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, output);
  const fixedResponse=await fetch(base+'/api/game',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'NEW',comparisonMode:'gemini',thinkingLevel:'HIGH',geminiModel:'gemini-3.5-flash'})});
  assert.equal(fixedResponse.status,200);const fixed=(await fixedResponse.json()).game;
  assert.equal(fixed.discussionPolicy,'player');assert.equal(fixed.endgameExposureAllowed,false);assert.equal(fixed.aiModel,'gemini-3.5-flash-lite');assert.equal(fixed.modelGuess,undefined);
  const fixedRow=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to',stateDir,'--json','--command',`SELECT state FROM games WHERE id='${fixed.id}'`],{encoding:'utf8'});
  assert.equal(fixedRow.status,0);const fixedStored=JSON.parse(JSON.parse(fixedRow.stdout)[0].results[0].state);
  assert.equal(fixedStored.aiConfig.endgameExposureAllowed,false);assert.equal(fixedStored.aiConfig.thinkingLevel,'MEDIUM');assert.equal(fixedStored.aiConfig.modelAssignmentVersion,'fixed-lite-medium-v1');assert.equal(fixedStored.aiConfig.modelComparisonVersion,null);
  for (const enabled of [true,false]) {
    const r=await fetch(base+'/api/game',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'NEW',comparisonMode:'gemini',endgameExposureAllowed:enabled})});
    assert.equal(r.status,200);const created=(await r.json()).game;assert.equal(created.endgameExposureAllowed,enabled);
    const reload=await request(created);assert.equal((await reload.json()).game.endgameExposureAllowed,enabled);
  }
  for (const policy of ['player','moderator']) {
    const r=await fetch(base+'/api/game',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'NEW',comparisonMode:'gemini',discussionPolicy:policy})});
    assert.equal(r.status,200);const created=(await r.json()).game;assert.equal(created.discussionPolicy,policy);
    assert.equal((await (await request(created)).json()).game.discussionPolicy,policy);
  }
  const invalidPolicy=await fetch(base+'/api/game',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'NEW',discussionPolicy:'everyone'})});assert.equal(invalidPolicy.status,400);
  const invalid=await fetch(base+'/api/game',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'NEW',endgameExposureAllowed:'false'})});assert.equal(invalid.status,400);
  let game = setup(); await seed(game); const initial = game.version;
  for (let i = 0; i < 4; i++) {
    const r = await request(game, { type: 'ADVANCE' }); assert.equal(r.status, 200);
    const data = await r.json(); assert.equal(data.game.messages.length, 0); assert.equal(data.game.phase, 'TEAM_DISCUSSION');
    assert.equal(data.game.assessmentPending, i < 3); assert.ok(!JSON.stringify(data.game).includes('speechPlan'));
    game.version = data.game.version;
  }
  assert.equal(game.version, initial + 4); assert.equal(calls, 4);
  // Export a synthetic ended snapshot to inspect accepted private records.
  const row = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', stateDir, '--json', '--command', `SELECT state FROM games WHERE id='${game.id}'`], { encoding: 'utf8' });
  const stored = JSON.parse(JSON.parse(row.stdout)[0].results[0].state); stored.phase = 'ENDED';
  await sql(`UPDATE games SET state='${escapeSql(JSON.stringify(stored))}' WHERE id='${game.id}';`);
  const log = await (await fetch(base + '/api/game?export=1', { headers: { cookie: `avalon_game=${game.id}` } })).json();
  assert.equal(Object.keys(log.game.privateAssessments).length, 4);
  assert.equal(log.events.filter(e => e.type === 'THINK' && e.detail.eventAssessment.status === 'OK').length, 4);
  assert.equal(log.modelUsage.filter(r => r.requestType === 'THINK' && r.status === 'RESPONDED').length, 4);

  game = setup(); await seed(game); failNext = true;
  const failed = await (await request(game, { type: 'ADVANCE' })).json();
  assert.ok(failed.notice.includes('상황 판단에 실패')); assert.equal(calls, 5); game.version = failed.game.version;
  // Hold one model response and race two ADVANCE calls: only the lease owner generates.
  let arrived = new Promise(resolve => { requestArrived = resolve; });
  const first = request(game, { type: 'ADVANCE' }); await arrived;
  const second = await (await request(game, { type: 'ADVANCE' })).json(); assert.equal(second.retryAfterMs, 1500);
  releaseResponse(); game.version = (await (await first).json()).game.version; assert.equal(calls, 6);
  // Human interruption commits first; obsolete judgment must not advance the queue.
  arrived = new Promise(resolve => { requestArrived = resolve; });
  const obsolete = request(game, { type: 'ADVANCE' }); await arrived;
  const chat = await (await request(game, { type: 'CHAT', text: '다른 팀도 비교해 주세요.' })).json();
  releaseResponse(); const discarded = await (await obsolete).json();
  assert.equal(discarded.game.version, chat.game.version); assert.equal(calls, 7);
  game.version = chat.game.version;
  const retried = await (await request(game, { type: 'ADVANCE' })).json(); assert.equal(retried.game.version, game.version + 1); assert.equal(calls, 8);
  let leaderGame=createGame(()=>.5);leaderGame.leader='ai1';leaderGame.aiConfig={...setup().aiConfig};leaderGame=apply(leaderGame,'human',{type:'START'});await seed(leaderGame);
  const leaderReply=await (await request(leaderGame,{type:'ADVANCE'})).json();assert.equal(leaderReply.game.phase,'PROPOSE');assert.equal(leaderReply.game.assessmentPending,false);assert.equal(calls,9);
  const legacyResult=setup();legacyResult.phase='QUEST_RESULT';legacyResult.pendingAssessment={kind:'QUEST_RESULT',eventId:'legacy-result',actors:['ai1','ai2','ai3','ai4']};await seed(legacyResult);
  const resultView=await (await request(legacyResult)).json();assert.equal(resultView.game.assessmentPending,false);
  const result = { passed: true, localWorker: true, fixedNewGameMedium:true,endgameExposureSettingVerified:true,discussionPolicyVerified:true,leaderBeforeProposalVerified:true,resultAssessmentRemoved:true, clientGenerationOverridesIgnored:true, acceptedActors: 4, failureCalls: 1, concurrentGenerationCalls: 1, staleDiscarded: true, syntheticModelCalls: calls, externalProviderCalls: 0 };
  await writeFile('.sites-runtime/assessment-api-result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  releaseResponse?.(); worker.kill(); await new Promise(resolve => server.close(resolve));
}
