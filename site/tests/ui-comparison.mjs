import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createGame,observe} from '../lib/game.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const out=process.env.AVALON_QA_OUTPUT;await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
const page=await browser.newPage();const errors=[],checks=[];let ready=true,game=null,input=null;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/game*',async route=>{if(route.request().method()==='POST'){input=route.request().postDataJSON();assert.equal(input.type,'NEW');game=createGame(()=>.5);}
  await route.fulfill({json:{game:game?{...observe(game),aiPending:false}:null,aiMode:'gemini',routingReady:ready}});});
try{
 for(const width of [1366,390])for(const selected of ['gemini','hybrid']){
  game=null;input=null;await page.setViewportSize({width,height:844});await page.goto(process.env.AVALON_URL);await page.getByRole('button',{name:'원탁에 앉기 →'}).waitFor();
  await page.locator('.game-settings > summary').click();await page.getByLabel('AI 비교 모드',{exact:true}).selectOption(selected);
  const area=await page.locator('.settings-content').boundingBox();assert.ok(area.x>=0&&area.x+area.width<=width+1);
  await page.screenshot({path:`${out}/${selected}-${width}.png`,fullPage:true,animations:'disabled'});
  await page.locator('.game-settings > summary').click();await page.getByRole('button',{name:'원탁에 앉기 →'}).click();await page.getByRole('dialog').waitFor();
  assert.equal(input.comparisonMode,selected);assert.equal(input.actionMode,selected==='hybrid'?'jev':'gemini');assert.equal(input.routingMode,selected==='hybrid'?'jev':'baseline');checks.push({width,selected});
 }
 ready=false;game=null;await page.goto(process.env.AVALON_URL);await page.getByRole('button',{name:'원탁에 앉기 →'}).waitFor();await page.locator('.game-settings > summary').click();
 assert.equal(await page.locator('#comparison-mode option[value="hybrid"]').isDisabled(),true);
 await page.getByLabel('AI 비교 모드',{exact:true}).selectOption('custom');await page.getByLabel('행동 선택',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);await writeFile(`${out}/validation.json`,JSON.stringify({checks,errors,modelCalls:0},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,modelCalls:0}));
}finally{await browser.close();}
