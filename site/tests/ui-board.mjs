// Run against a local build; all game API responses are synthetic and no model is called.
// PLAYWRIGHT_MODULE may point to the bundled Playwright index.mjs; BROWSER_PATH to installed Chrome.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createGame,apply,observe,IDS} from '../lib/game.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.AVALON_URL??'http://127.0.0.1:5186';
const out=process.env.AVALON_QA_OUTPUT??'.sites-runtime/board-qa';
await mkdir(out,{recursive:true});
let game=createGame(()=>.5);game.leader='human';game.roles={human:'LOYAL',ai1:'ASSASSIN',ai2:'MERLIN',ai3:'MINION',ai4:'LOYAL'};
game=apply(game,'human',{type:'START'});
for(const [leader,team,fails] of [['human',['human','ai1'],true],['ai2',['human','ai2','ai4'],false]]){
  game.leader=leader;game=apply(game,leader,{type:'PROPOSE',team});game=apply(game,'human',{type:'START_VOTE'});
  for(const actor of IDS)game=apply(game,actor,{type:'VOTE',choice:actor==='ai3'?'REJECT':'APPROVE'});
  game=apply(game,'human',{type:'CONTINUE'});
  for(const actor of team)game=apply(game,actor,{type:'CARD',choice:fails&&actor==='ai1'?'FAIL':'SUCCESS'});
  game=apply(game,'human',{type:'CONTINUE'});
}
game.leader='human';
for(let i=0;i<18;i++)game.messages.push({id:`fixture-${i}`,actor:IDS[(i%4)+1],text:['지난 원정에서 실패가 나왔어요. 이번에는 팀을 바꿔야 합니다.','하린과 서아를 함께 보내는 건 반대합니다.','도윤과 지호가 포함된 팀은 성공했죠. 그 결과를 참고합시다.'][i%3],at:new Date(Date.now()+i*1000).toISOString(),version:game.version+i});
const initial=structuredClone(game),calls=[],errors=[];
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const page=await browser.newPage();
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/game*',async route=>{
  const request=route.request();
  if(request.method()==='POST'){
    const action=request.postDataJSON();calls.push(action.type);
    assert.notEqual(action.type,'ADVANCE','No AI calls expected in synthetic UI scenarios');
    game=apply(game,'human',action);
    if(action.type==='VOTE')for(const actor of IDS.filter(x=>x!=='human'))game=apply(game,actor,{type:'VOTE',choice:actor==='ai3'?'REJECT':'APPROVE'});
    if(action.type==='CARD')for(const actor of game.team.filter(x=>x!=='human'))game=apply(game,actor,{type:'CARD',choice:'SUCCESS'});
  }
  await route.fulfill({json:{game:{...observe(game),aiPending:false,idleDueAt:null,routingMode:'baseline'},aiMode:'practice',routingReady:false}});
});
const layouts=[];
try{
  for(const [width,height] of [[1440,900],[1366,768],[1024,768],[820,1180],[390,844],[320,740],[390,600]]){
    game=structuredClone(initial);await page.setViewportSize({width,height});await page.goto(base);await page.getByRole('heading',{name:'채팅 내역'}).waitFor();
    const layout=await page.evaluate(()=>{
      const box=selector=>{const {x,y,width,height,right,bottom}=document.querySelector(selector).getBoundingClientRect();return {x,y,width,height,right,bottom}};
      return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,board:box('.board-table'),chat:box('.conversation'),center:box('.team-context'),players:[...document.querySelectorAll('.player')].map(el=>{const {x,y,right,bottom}=el.getBoundingClientRect();return {x,y,right,bottom}})};
    });
    assert.ok(layout.scrollWidth<=width,`horizontal overflow at ${width}`);
    if(height>=700)assert.ok(layout.scrollHeight<=height+1,`page exceeds viewport at ${width}x${height}: ${layout.scrollHeight}`);
    for(const p of layout.players){assert.ok(p.x>=layout.board.x-1&&p.right<=layout.board.right+1,`player outside board at ${width}`);if(width>900){assert.ok(p.right<=layout.chat.x,`player overlaps chat at ${width}`);const c=layout.center;assert.ok(p.right<=c.x||p.x>=c.right||p.bottom<=c.y||p.y>=c.bottom,`player overlaps team label at ${width}`);}}
    if(width<=900){assert.ok(layout.players.every(p=>Math.abs(p.y-layout.players[0].y)<1));assert.ok(layout.chat.y>=layout.players[0].bottom);}
    layouts.push(layout);
    const first=page.getByRole('button',{name:'1번째 원정 실패 · 기록 보기',exact:true});await first.click();
    const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'1번째 원정 실패',exact:true}).waitFor();
    await dialog.getByText('유저의 원정 팀',{exact:false}).waitFor();await dialog.getByText('찬성 4',{exact:true}).waitFor();await dialog.getByText('반대 1',{exact:true}).waitFor();
    assert.equal((await dialog.locator('.popup-card-result strong').innerText()).replace(/\s/g,''),'1장');
    if(width===1440||width===390&&height===844)await page.screenshot({path:path.join(out,`board-history-${width}.png`),fullPage:true,animations:'disabled'});
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await first.evaluate(el=>el===document.activeElement),true);
    await page.getByRole('button',{name:'2번째 원정 성공 · 기록 보기',exact:true}).click();await dialog.getByRole('heading',{name:'2번째 원정 성공',exact:true}).waitFor();await dialog.getByText('도윤의 원정 팀',{exact:false}).waitFor();
    assert.equal((await dialog.locator('.popup-card-result strong').innerText()).replace(/\s/g,''),'0장');
    await dialog.getByRole('button',{name:'확인 · 게임으로 돌아가기'}).click();
    if(width===1440||width===390&&height===844)await page.screenshot({path:path.join(out,`board-layout-${width}.png`),fullPage:true,animations:'disabled'});
  }
  await page.setViewportSize({width:1366,height:768});
  await page.getByRole('button',{name:'유저 리더 · 팀 선택',exact:true}).click();await page.getByRole('button',{name:'지호 · 팀 선택',exact:true}).click();
  assert.equal(await page.locator('.player[aria-pressed="true"]').count(),2);
  assert.equal(await page.getByRole('button',{name:'하린 · 팀 선택',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'팀 초안 공유',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'원정 팀 초안',exact:true}).waitFor();
  await page.getByRole('button',{name:'확인 · 대화로 돌아가기'}).click();await page.getByRole('button',{name:'이 팀으로 투표 →',exact:true}).click();
  await page.getByRole('button',{name:'찬성',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'원정 팀 승인',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'board-vote-popup.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'확인 · 대화로 돌아가기'}).click();await page.getByRole('button',{name:'원정 출발 →'}).click();await page.getByRole('button',{name:'성공',exact:true}).click();
  await page.getByRole('dialog').getByRole('heading',{name:'원정 성공',exact:true}).waitFor();await page.screenshot({path:path.join(out,'board-success-popup.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'확인 · 대화로 돌아가기'}).click();
  await page.locator('.messages').evaluate(el=>el.scrollTop=0);await page.getByLabel('채팅 메시지',{exact:true}).fill('예전 기록을 확인하고 있습니다.');assert.equal(await page.locator('.messages').evaluate(el=>el.scrollTop),0);
  assert.deepEqual(errors,[]);assert.deepEqual(calls,['PROPOSE','START_VOTE','VOTE','CONTINUE','CARD']);
  await writeFile(path.join(out,'board-ui-validation.json'),JSON.stringify({synthetic:true,modelCalls:0,layouts,calls,errors},null,2));
  console.log(JSON.stringify({passed:true,viewports:layouts.length,calls,modelCalls:0,output:out}));
}finally{await browser.close();}
