// Synthetic API states exercise the actual built UI. No model or production game is called.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';import {pathToFileURL} from 'node:url';
import {createGame,apply,observe,IDS} from '../lib/game.mjs';
import {ROLE_GUESS_VERSION} from '../lib/role-guess.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.AVALON_URL??'http://127.0.0.1:5188',out=process.env.AVALON_QA_OUTPUT??'.sites-runtime/role-guess-ui';
await mkdir(out,{recursive:true});
const setup=result=>({...createGame(()=>.5),version:40,phase:result==='REJECTED'?'VOTE_RESULT':'QUEST_RESULT',attempt:result==='REJECTED'?5:1,quest:2,leader:'ai1',team:['ai1','ai2'],pendingDiscussion:'result',
  roles:{human:'LOYAL',ai1:'MERLIN',ai2:'LOYAL',ai3:'ASSASSIN',ai4:'MINION'},
  quests:result==='REJECTED'?[]:Array.from({length:3},(_,i)=>({id:`quest-${i+1}`,proposalId:`p${i+1}`,team:['ai1','ai2'],result,fails:result==='FAIL'?1:0})),
  proposals:Array.from({length:result==='REJECTED'?5:3},(_,i)=>({id:`p${i+1}`,quest:i+1,attempt:result==='REJECTED'?i+1:1,leader:'ai1',team:['ai1','ai2'],status:result==='REJECTED'?'REJECTED':'APPROVED',approveCount:result==='REJECTED'?0:5,votes:IDS.map(actor=>({actor,choice:result==='REJECTED'?'REJECT':'APPROVE'}))})),
  publicEvents:[{id:'event-40',kind:'QUEST_RESULT',text:`3번째 원정 ${result==='SUCCESS'?'성공':'실패'}`,at:new Date().toISOString(),version:40}],
  aiConfig:{manualProgress:true,conversationVersion:1,roleGuessVersion:ROLE_GUESS_VERSION,actionMode:'jev'},conversation:{burst:0,turns:0}});
let game;const calls=[],errors=[],layouts=[];
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/game*',async route=>{
  try{if(route.request().method()==='POST'){
    const a=route.request().postDataJSON();calls.push(a.type);assert.notEqual(a.type,'ADVANCE','No AI call during synthetic guess');
    game=apply(game,'human',a);
    if(a.type==='ROLE_GUESS')game=apply(game,'system',{type:'SILENCE',idleTrigger:true});
    if(game.phase==='ASSASSINATE')game=apply(game,'ai3',{type:'ASSASSINATE',target:'ai1'});
  }
  await route.fulfill({json:{game:{...observe(game),aiPending:false,idleDueAt:null,routingMode:'jev',actionMode:'jev'},aiMode:'gemini',routingReady:true}});
  }catch(e){await route.fulfill({status:400,json:{error:e.message}});}
});
try{
 for(const [width,height,result] of [[1366,768,'SUCCESS'],[390,668,'SUCCESS'],[390,668,'FAIL'],[1366,768,'REJECTED'],[390,668,'REJECTED']]){
  game=setup(result);await page.setViewportSize({width,height});await page.goto(base);
  await page.getByRole('dialog').getByRole('heading',{name:result==='SUCCESS'?'원정 성공':result==='FAIL'?'원정 실패':'원정 팀 부결',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'누가 어떤 역할이었을까요?'}).count(),0);
  await page.getByRole('button',{name:'확인 · 대화로 돌아가기',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'누가 어떤 역할이었을까요?'}).waitFor();
  await dialog.evaluate(async el=>{await document.fonts.ready;await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});
  assert.equal(await dialog.getByRole('combobox').count(),8);assert.equal(await dialog.getByRole('button',{name:'추측 제출',exact:true}).isDisabled(),true);
  const layout=await dialog.evaluate(el=>{const b=el.getBoundingClientRect();return {width:innerWidth,height:innerHeight,x:b.x,right:b.right,y:b.y,bottom:b.bottom,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,documentWidth:document.documentElement.scrollWidth};});
  await page.screenshot({path:path.join(out,`role-guess-initial-${width}-${result}.png`),fullPage:true,animations:'disabled'});
  assert.ok(layout.x>=0&&layout.right<=width,JSON.stringify(layout));assert.ok(layout.y>=0&&layout.bottom<=height,JSON.stringify(layout));assert.ok(layout.documentWidth<=width,JSON.stringify(layout));layouts.push(layout);
  await page.reload();await dialog.getByRole('heading',{name:'누가 어떤 역할이었을까요?'}).waitFor();
  const continueLabel=result==='REJECTED'?'최종 결과 확인 →':'결과 확인하고 계속 →';
  await dialog.getByRole('button',{name:'기록을 보며 더 생각하기'}).click();assert.equal(await page.getByRole('button',{name:continueLabel}).isDisabled(),true);
  await page.getByRole('button',{name:'플레이어 역할 맞히기',exact:true}).click();
  if(width===1366){
    for(const id of ['ai1','ai2','ai3','ai4']){assert.equal(await page.locator(`#guess-${id}`).isDisabled(),true);await page.locator(`#guess-faction-${id}`).click();await page.getByRole('option',{name:'선',exact:true}).click();}
    for(const id of ['ai1','ai2','ai3','ai4']){await page.locator(`#guess-${id}`).click();await page.getByRole('option',{name:'멀린',exact:true}).click();}
    await dialog.getByRole('button',{name:'추측 제출',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(game.roleGuess,undefined);assert.equal(await page.locator('#guess-ai1').innerText(),'멀린');
  }
  const sameFaction=result==='REJECTED';
  for(const [id,role] of sameFaction?[['ai1','충신'],['ai2','멀린'],['ai3','악의 하수인'],['ai4','암살자']]:[['ai1','멀린'],['ai2','충신'],['ai3','암살자'],['ai4','악의 하수인']]){
    await page.locator(`#guess-faction-${id}`).click();await page.getByRole('option',{name:['멀린','충신'].includes(role)?'선':'악',exact:true}).click();
    await page.locator(`#guess-${id}`).click();assert.equal(await page.getByRole('option').count(),2);await page.getByRole('option',{name:role,exact:true}).click();
  }
  await page.locator('#guess-faction-ai1').click();await page.getByRole('option',{name:'악',exact:true}).click();
  assert.equal(await page.locator('#guess-ai1').innerText(),'역할 선택');assert.equal(await dialog.getByRole('button',{name:'추측 제출',exact:true}).isDisabled(),true);
  await page.locator('#guess-faction-ai1').click();await page.getByRole('option',{name:'선',exact:true}).click();
  await page.locator('#guess-ai1').click();await page.getByRole('option',{name:sameFaction?'충신':'멀린',exact:true}).click();
  await page.screenshot({path:path.join(out,`role-guess-${width}-${result}.png`),fullPage:true,animations:'disabled'});
  await dialog.getByRole('button',{name:'추측 제출',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.deepEqual(observe(game).roleGuess,{pending:false,submitted:true});assert.equal(await page.getByText('4 / 4명 정답',{exact:false}).count(),0);
  await page.reload();assert.equal(await page.getByRole('heading',{name:/역할 추측 ·/}).count(),0);
  await page.getByRole('button',{name:continueLabel}).click();await page.getByRole('heading',{name:`역할 추측 · ${sameFaction?0:4} / 4명 정답`,exact:true}).waitFor();
  await page.getByText(`시작 역할: 충신 · 진영 4 / 4명 정답 · 세부 역할 ${sameFaction?0:4} / 4명 정답`,{exact:true}).waitFor();
  assert.equal(game.roleGuess.factionCorrect,4);if(sameFaction){assert.equal(game.winner,'EVIL');assert.equal(game.roleGuess.checkpoint,'FIVE_REJECTIONS');}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('.guess-summary').scrollIntoViewIfNeeded();
  if(width===390){
    assert.equal(await page.locator('.game-controls').evaluate(el=>getComputedStyle(el).overflowY),'auto');
    await page.locator('.guess-summary p').last().scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.guess-summary p').last().evaluate(el=>{
      const b=el.getBoundingClientRect(),panel=el.closest('.game-controls').getBoundingClientRect(),chat=document.querySelector('.conversation').getBoundingClientRect();
      return b.top>=panel.top&&b.bottom<=panel.bottom+1&&b.bottom<=chat.top+1;
    }),'Last score must be visible inside its panel without overlapping chat');
  }
  if(width===390)await page.screenshot({path:path.join(out,`role-guess-score-390-${result}.png`),fullPage:true,animations:'disabled'});
 }
 assert.deepEqual(errors,[]);assert.ok(!calls.includes('ADVANCE'));
 await writeFile(path.join(out,'validation.json'),JSON.stringify({passed:true,synthetic:true,modelCalls:0,layouts,calls,pageErrors:errors},null,2));
 console.log(JSON.stringify({passed:true,synthetic:true,layouts:layouts.length,modelCalls:0,pageErrors:errors}));
}finally{await browser.close();}
