// Actual UI + synthetic API only. Uses the same local Playwright options as ui-board.mjs.
import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {createGame,observe,apply} from '../lib/game.mjs';import {roleGuide} from '../lib/role-guide.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=process.env.AVALON_QA_OUTPUT??'.sites-runtime/role-guide-qa';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const page=await browser.newPage({reducedMotion:'reduce'});const errors=[],calls=[],checks=[];let game;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/game*',async route=>{if(route.request().method()==='POST'){const input=route.request().postDataJSON();calls.push(input.type);assert.equal(input.type,'START');game=apply(game,'human',input);}await route.fulfill({json:{game:{...observe(game),aiPending:false,idleDueAt:null},aiMode:'practice',routingReady:false}});});
try{
 for(const [width,height] of [[1366,768],[390,844],[320,740]])for(const role of ['LOYAL','MERLIN','ASSASSIN','MINION']){
  game=createGame(()=>.5);const owner=Object.keys(game.roles).find(id=>game.roles[id]===role);[game.roles.human,game.roles[owner]]=[game.roles[owner],game.roles.human];game.leader='human';
  await page.setViewportSize({width,height});await page.goto(process.env.AVALON_URL??'http://127.0.0.1:5190');
  const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:`당신은 ${roleGuide(role).name}입니다`}).waitFor();
  await dialog.getByText('승리 조건',{exact:true}).waitFor();await dialog.getByText('나만 아는 시작 정보',{exact:true}).waitFor();
  if(role==='ASSASSIN')await dialog.getByText('원정 3회 성공 후 한 명을 한 번 지목합니다.',{exact:false}).waitFor();
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),1);
  await dialog.getByRole('button',{name:'이번 판 역할들',exact:true}).click();await dialog.getByRole('heading',{name:'이번 판 역할들'}).waitFor();
  await dialog.getByRole('heading',{name:'선 진영 · 3명'}).waitFor();await dialog.getByRole('heading',{name:'악 진영 · 2명'}).waitFor();
  for(const name of ['하린','도윤','서아','지호'])assert.equal((await dialog.innerText()).includes(name),false);
  assert.equal(await dialog.locator('.role-entry').count(),4);await dialog.locator('.role-entry > summary').filter({hasText:'암살자'}).click();await dialog.getByText('원정 3회 성공 후 한 명을 한 번 지목합니다.',{exact:false}).waitFor();
  assert.equal((await dialog.innerText()).includes('오베론'),false);
  if(role==='ASSASSIN')await page.screenshot({path:path.join(out,`public-roles-${width}.png`),fullPage:true,animations:'disabled'});
  await dialog.getByRole('button',{name:'내 역할로 돌아가기'}).click();await dialog.getByRole('heading',{name:`당신은 ${roleGuide(role).name}입니다`}).waitFor();
  const rect=await dialog.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1&&rect.y>=0&&rect.y+rect.height<=height+1);
  if(role==='ASSASSIN')await page.screenshot({path:path.join(out,`my-role-${width}.png`),fullPage:true,animations:'disabled'});
  await dialog.getByRole('button',{name:'확인하고 게임 시작 →'}).click();await page.getByRole('heading',{name:'팀 초안 선정'}).waitFor();assert.equal(await dialog.count(),0);
  assert.equal((await page.locator('.brand').innerText()).includes('다섯'),false);
  const before=calls.length;const mine=page.getByRole('button',{name:'♜ 내 역할 확인',exact:true});await mine.click();await dialog.getByRole('heading',{name:`당신은 ${roleGuide(role).name}입니다`}).waitFor();await dialog.getByRole('button',{name:'확인하고 닫기'}).click();await page.waitForFunction(()=>document.activeElement?.textContent?.includes('내 역할 확인'));
  await page.getByRole('button',{name:'이번 판 역할들',exact:true}).click();await dialog.getByRole('heading',{name:'이번 판 역할들'}).waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(calls.length,before);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(role==='ASSASSIN')await page.screenshot({path:path.join(out,`role-buttons-${width}.png`),fullPage:true,animations:'disabled'});
  checks.push({width,height,role,passed:true});
 }
 assert.deepEqual(errors,[]);assert.equal(calls.length,12);await writeFile(path.join(out,'validation.json'),JSON.stringify({synthetic:true,checks,calls,errors,modelCalls:0},null,2));console.log(JSON.stringify({passed:true,scenarios:checks.length,modelCalls:0}));
}finally{await browser.close();}
