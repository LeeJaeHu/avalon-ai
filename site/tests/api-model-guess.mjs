// Local Worker integration; never invokes a model or a production endpoint.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createGame} from '../lib/game.mjs';
import {MODEL_ASSIGNMENT_VERSION,newGameGeminiGeneration,fixedGameGeminiConfig} from '../lib/gemini-models.mjs';
const base=process.env.AVALON_URL??'http://127.0.0.1:5188';
assert.equal(new URL(base).hostname,'127.0.0.1');
const g={...createGame(()=>.5),aiConfig:{...newGameGeminiGeneration('gemini-3.5-flash-lite'),model:'gemini-3.5-flash-lite',modelAssignmentVersion:MODEL_ASSIGNMENT_VERSION,manualProgress:true,conversationVersion:1}};
await mkdir('.sites-runtime',{recursive:true});
const sqlPath=`.sites-runtime/api-model-guess-${g.id}.sql`;
async function sql(command){
  await writeFile(sqlPath,command);
  const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/state','--file',sqlPath],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
}
const escaped=s=>s.replaceAll("'","''");
const headers={'content-type':'application/json',cookie:`avalon_game=${g.id}`};
const get=path=>fetch(`${base}/api/game${path}`,{headers});
const post=body=>fetch(`${base}/api/game`,{method:'POST',headers,body:JSON.stringify(body)});
try{
  await sql(`INSERT INTO games(id,version,state,created_at,updated_at) VALUES('${g.id}',0,'${escaped(JSON.stringify(g))}','${g.createdAt}','${g.createdAt}');`);
  const hidden=await (await get('')).json();assert.equal(hidden.game.aiModel,null);assert.equal(hidden.game.usage,null);assert.equal(hidden.game.thinkingLevel,undefined);assert.equal(hidden.game.modelGuess.actualThinkingLevel,undefined);
  assert.equal((await get('?diagnostics=1')).status,409);assert.equal((await get('?export=1')).status,409);
  assert.equal((await post({type:'MODEL_GUESS',version:0,choice:'gemini-3.5-flash'})).status,400);
  g.phase='ENDED';g.winner='EVIL';
  await sql(`UPDATE games SET state='${escaped(JSON.stringify(g))}' WHERE id='${g.id}';`);
  assert.equal((await (await get('')).json()).game.modelGuess.pending,true);
  const responses=await Promise.all([1,2].map(()=>post({type:'MODEL_GUESS',version:0,choice:'gemini-3.5-flash'})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const visible=await (await get('')).json();assert.equal(visible.game.aiModel,g.aiConfig.model);assert.equal(visible.game.modelGuess.correct,false);assert.equal(visible.game.modelGuess.actualThinkingLevel,"HIGH");
  assert.equal((await post({type:'MODEL_GUESS',version:1,choice:g.aiConfig.model})).status,400);
  assert.equal((await get('?diagnostics=1')).status,200);
  const log=await (await get('?export=1')).json();assert.equal(log.game.modelGuess.choice,'gemini-3.5-flash');assert.equal(log.events.filter(e=>e.type==='MODEL_GUESS').length,1);
  const result={passed:true,localWorker:true,concurrentStatuses:[200,409],modelCalls:0};
  if(process.env.AVALON_QA_OUTPUT){await mkdir(process.env.AVALON_QA_OUTPUT,{recursive:true});await writeFile(`${process.env.AVALON_QA_OUTPUT}/api-validation.json`,JSON.stringify(result,null,2));}
  console.log(JSON.stringify(result));
}finally{await sql(`DELETE FROM events WHERE game_id='${g.id}'; DELETE FROM games WHERE id='${g.id}';`);}

// NEW stores fixed Lite MEDIUM; client generation overrides are ignored.
const response=await fetch(base+'/api/game',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'NEW',comparisonMode:'hybrid',thinkingLevel:'HIGH',geminiModel:'invalid'})});
assert.equal(response.status,200);const created=(await response.json()).game;
assert.equal(created.aiModel,'gemini-3.5-flash-lite');assert.equal(created.thinkingLevel,undefined);
const lookup=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/state','--json','--command',"SELECT state FROM games WHERE id='"+created.id+"'"],{encoding:'utf8'});
assert.equal(lookup.status,0);const rows=JSON.parse(lookup.stdout);const stored=JSON.parse(rows[0].results[0].state);
assert.deepEqual(fixedGameGeminiConfig(),Object.fromEntries(Object.keys(fixedGameGeminiConfig()).map(k=>[k,stored.aiConfig[k]])));
assert.equal(stored.aiConfig.modelComparisonVersion,null);
await sql("DELETE FROM events WHERE game_id='"+created.id+"'; DELETE FROM games WHERE id='"+created.id+"';");
console.log(JSON.stringify({newGamePairFixed:true,clientOverridesIgnored:true,modelCalls:0}));
