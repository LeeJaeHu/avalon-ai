// Actual built client, synthetic engine/model responses. No production game writes.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createGame,apply,observe,IDS} from '../lib/game.mjs';
import {decide,nextAiAction} from '../lib/ai.mjs';
import {JEV_MODEL} from '../lib/discussion-routing.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const originalFetch=globalThis.fetch;
let scenario='TALK',jevCalls=0,geminiCalls=0;
globalThis.fetch=async(url,init)=>{
 const b=JSON.parse(init.body);
 if(url.includes('typesafe')){jevCalls++;const keys=Object.keys(b.questions.responder.criteria),need=scenario==='WAIT'||geminiCalls>0?'WAIT':'TALK';return Response.json({model:JEV_MODEL,usage:{input_tokens:100},answers:{responder:{type:'choice',choice:'ai2',confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k==='ai2'?1:0]))},discussion:{type:'choice',choice:need,confidence:1,probabilities:{TALK:need==='TALK'?1:0,WAIT:need==='WAIT'?1:0}}}});}
 geminiCalls++;return Response.json({usageMetadata:{promptTokenCount:100,candidatesTokenCount:30},candidates:[{content:{parts:[{text:JSON.stringify(scenario==='SILENCE'?{type:'SILENCE',thinking:'합성 자율 침묵'}:{type:'CHAT',text:'이번 공개 결과를 보면 하린과 도윤을 다음 팀에서 비교하고 싶어요.',speechAct:'EVIDENCE',thinking:'합성 테스트 생각'})}]}}]});
};
function scene(phase) {
 let g=createGame(()=>.5);g.leader='human';g.aiConfig={conversationVersion:1,manualProgress:true,routingMode:'jev'};
 g=apply(g,'human',{type:'START'});g=apply(g,'human',{type:'PROPOSE',team:['human','ai1']});
 if(phase==='TEAM_DISCUSSION')return g;
 g=apply(g,'system',{type:'SILENCE'});g=apply(g,'human',{type:'START_VOTE'});for(const id of IDS)g=apply(g,id,{type:'VOTE',choice:'APPROVE'});
 if(phase==='VOTE_RESULT')return g;
 g=apply(g,'system',{type:'SILENCE'});g=apply(g,'human',{type:'CONTINUE'});g=apply(g,'human',{type:'CARD',choice:'SUCCESS'});return apply(g,'ai1',{type:'CARD',choice:'SUCCESS'});
}
let game;const checks=[],errors=[];
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH}),page=await browser.newPage();
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/game*',async route=>{
 if(route.request().method()==='POST') {
  const input=route.request().postDataJSON();
  if(input.type==='ADVANCE') {
   const request=nextAiAction(game);if(request){const d=request.actor==='system'?{actor:request.actor,action:request}:await decide(game,request,'synthetic',null,{key:'synthetic'});game=apply(game,d.actor,d.action);}
  } else game=apply(game,'human',{...input,speechAct:'OTHER'});
 }
 await route.fulfill({json:{game:{...observe(game),aiPending:!!nextAiAction(game)},aiMode:'gemini',routingReady:true}});
});
try {
 for(const width of [1366,390])for(const phase of ['TEAM_DISCUSSION','VOTE_RESULT','QUEST_RESULT'])for(const outcome of ['TALK','WAIT','SILENCE']) {
  scenario=outcome;jevCalls=0;geminiCalls=0;
  game=scene(phase);await page.setViewportSize({width,height:768});await page.goto(process.env.AVALON_URL);
  await page.getByRole('dialog').waitFor();assert.equal(game.messages.length,0);
  await page.getByRole('button',{name:'확인 · 대화로 돌아가기',exact:true}).click();
  await page.locator('.decision-reading button').waitFor({state:'visible'});
  assert.equal(await page.locator('.decision-reading button').isDisabled(),true);
  await page.waitForFunction(()=>!document.querySelector('.decision-reading button')?.disabled);
  assert.equal(await page.locator('#next-stage-status').textContent(),'다음 단계로 진행할 수 있어요.');
  assert.equal(game.phase,phase);assert.equal(game.messages.length,outcome==='TALK'?1:0);assert.equal(game.pendingDiscussion,null);
  assert.equal(geminiCalls,outcome==='WAIT'?0:1);assert.equal(jevCalls,outcome==='TALK'?2:1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  checks.push({width,phase,outcome,geminiCalls,jevCalls,manualContinueEnabled:true});
 }
 assert.deepEqual(errors,[]);await mkdir(process.env.AVALON_QA_OUTPUT,{recursive:true});
 await writeFile(`${process.env.AVALON_QA_OUTPUT}/ui-validation.json`,JSON.stringify({passed:true,checks,errors,externalProviderCalls:0},null,2));
 console.log(JSON.stringify({passed:true,scenarios:checks.length,externalProviderCalls:0}));
} finally {globalThis.fetch=originalFetch;await browser.close();}
