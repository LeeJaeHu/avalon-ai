import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
import {createGame,observe} from '../lib/game.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});const page=await browser.newPage();const errors=[],checks=[];let game=null,input=null;
const out=process.env.AVALON_QA_OUTPUT;await mkdir(out,{recursive:true});page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/game*',async route=>{if(route.request().method()==='POST'){input=route.request().postDataJSON();assert.equal(input.type,'NEW');game=createGame(()=>.5,input.humanRoleMode);game.aiConfig={humanRoleMode:input.humanRoleMode};}await route.fulfill({json:{game:game?{...observe(game),humanRoleMode:game.aiConfig.humanRoleMode,aiPending:false}:null,aiMode:'practice',routingReady:false}});});
try{for(const width of [1366,390])for(const mode of ['loyal-fixed','random']){
 game=null;input=null;await page.setViewportSize({width,height:844});await page.goto(process.env.AVALON_URL);await page.getByRole('button',{name:'원탁에 앉기 →'}).waitFor();
 await page.locator('.game-settings > summary').click();assert.equal(await page.getByLabel('사용자 역할 배정',{exact:true}).inputValue(),'loyal-fixed');await page.getByLabel('사용자 역할 배정',{exact:true}).selectOption(mode);
 await page.screenshot({path:`${out}/${mode}-${width}.png`,fullPage:true});await page.locator('.game-settings > summary').click();await page.getByRole('button',{name:'원탁에 앉기 →'}).click();await page.getByRole('dialog').waitFor();assert.equal(input.humanRoleMode,mode);if(mode==='loyal-fixed')assert.equal(game.roles.human,'LOYAL');
 await page.reload();await page.getByRole('dialog').waitFor();assert.equal(game.aiConfig.humanRoleMode,mode);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push({width,mode});
}assert.deepEqual(errors,[]);await writeFile(`${out}/validation.json`,JSON.stringify({checks,errors,synthetic:true,modelCalls:0},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,errors}));}finally{await browser.close();}
