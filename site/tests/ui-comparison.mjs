import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {MODEL_ASSIGNMENT_VERSION,modelHidden,newGameGeminiGeneration} from '../lib/gemini-models.mjs';
import {createGame,apply,observe} from '../lib/game.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const out=process.env.AVALON_QA_OUTPUT;await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
const page=await browser.newPage();const errors=[],checks=[];let ready=true,game=null,input=null;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/game*',async route=>{if(route.request().method()==='POST'){input=route.request().postDataJSON();if(input.type==='NEW')game=createGame(()=>.5);else game=apply(game,'human',input);}
  await route.fulfill({json:{game:game?{...observe(game),geminiGenerationVersion:game.aiConfig?.geminiGenerationVersion??null,aiModel:modelHidden(game)?null:game.aiConfig?.model??null,aiPending:false}:null,aiMode:'gemini',routingReady:ready}});});
try{
 for(const width of [1366,390])for(const selected of ['gemini','hybrid'])for(const model of ['gemini-3.5-flash-lite','gemini-3.5-flash']){
  game=null;input=null;await page.setViewportSize({width,height:844});await page.goto(process.env.AVALON_URL);await page.getByRole('button',{name:'원탁에 앉기 →'}).waitFor();
  await page.locator('.game-settings > summary').click();await page.getByLabel('AI 비교 모드',{exact:true}).selectOption(selected);
  assert.equal(await page.locator('#gemini-model').count(),0);await page.getByText('Gemini 모델 무작위 비교',{exact:true}).waitFor();
  const area=await page.locator('.settings-content').boundingBox();assert.ok(area.x>=0&&area.x+area.width<=width+1);
  await page.screenshot({path:`${out}/${selected}-${model}-${width}.png`,fullPage:true,animations:'disabled'});
  await page.locator('.game-settings > summary').click();await page.getByRole('button',{name:'원탁에 앉기 →'}).click();await page.getByRole('dialog').waitFor();
  assert.equal(input.comparisonMode,selected);assert.equal(input.geminiModel,undefined);assert.equal(input.actionMode,selected==='hybrid'?'jev':'gemini');assert.equal(input.routingMode,selected==='hybrid'?'jev':'baseline');checks.push({width,selected,model});
 }
 for(const width of [1366,390])for(const actual of ['gemini-3.5-flash-lite','gemini-3.5-flash']){
  game={...createGame(()=>.5),phase:'ENDED',winner:'EVIL',aiConfig:{...newGameGeminiGeneration(actual),model:actual,modelAssignmentVersion:MODEL_ASSIGNMENT_VERSION}};
  await page.setViewportSize({width,height:844});await page.goto(process.env.AVALON_URL);
  await page.getByLabel('이번 게임은 어떤 모델이었던 것 같나요?').waitFor();
  assert.equal(await page.getByRole('button',{name:'모델 추측 제출',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('link',{name:'게임 기록 다운로드',exact:true}).count(),0);
  assert.ok((await page.locator('#model-guess').textContent()).includes('HIGH'));assert.ok((await page.locator('#model-guess').textContent()).includes('MINIMAL'));
  await page.reload();await page.getByLabel('이번 게임은 어떤 모델이었던 것 같나요?').selectOption(actual);
  await page.screenshot({path:`${out}/model-guess-${actual}-${width}.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'모델 추측 제출',exact:true}).click();
  await page.getByText(/모델 추측 정답/).waitFor();await page.getByRole('link',{name:'게임 기록 다운로드',exact:true}).waitFor();
  assert.equal(input.type,'MODEL_GUESS');assert.equal(game.modelGuess.choice,actual);assert.equal(game.modelGuess.actualThinkingLevel,actual.endsWith('lite')?'HIGH':'MINIMAL');
  assert.equal(await page.locator('#model-guess').count(),0);checks.push({width,actual,guess:true});
 }
 ready=false;game=null;await page.goto(process.env.AVALON_URL);await page.getByRole('button',{name:'원탁에 앉기 →'}).waitFor();await page.locator('.game-settings > summary').click();
 assert.equal(await page.locator('#comparison-mode option[value="hybrid"]').isDisabled(),true);
 await page.getByLabel('AI 비교 모드',{exact:true}).selectOption('custom');await page.getByLabel('행동 선택',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);await writeFile(`${out}/validation.json`,JSON.stringify({checks,errors,modelCalls:0},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,modelCalls:0}));
}finally{await browser.close();}
