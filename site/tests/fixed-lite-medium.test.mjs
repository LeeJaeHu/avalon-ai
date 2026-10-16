import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedGameGeminiConfig,geminiGeneration,modelHidden,modelGuessPending,newGameGeminiGeneration,MODEL_ASSIGNMENT_VERSION} from '../lib/gemini-models.mjs';
import {createGame,apply} from '../lib/game.mjs';
import {decide} from '../lib/ai.mjs';

test('고정 판은 Lite MEDIUM 요청을 보내고 과거 블라인드 판과 생성 설정을 보존한다',async()=>{
  const config=fixedGameGeminiConfig();
  assert.deepEqual(geminiGeneration(config),{maxOutputTokens:8192,thinkingConfig:{thinkingLevel:'MEDIUM'}});
  for(const wrong of [{model:'gemini-3.5-flash'},{thinkingLevel:'HIGH'},{maxOutputTokens:768}])assert.throws(()=>geminiGeneration({...config,...wrong}));
  const game={...createGame(()=>.5),phase:'ENDED',winner:'GOOD',aiConfig:config};
  assert.equal(modelHidden(game),false);assert.equal(modelGuessPending(game),false);
  const old={...game,aiConfig:{model:'gemini-3.5-flash-lite',...newGameGeminiGeneration('gemini-3.5-flash-lite'),modelAssignmentVersion:MODEL_ASSIGNMENT_VERSION}};
  assert.equal(modelHidden(old),true);assert.equal(geminiGeneration(old.aiConfig).thinkingConfig.thinkingLevel,'HIGH');
  let active=createGame(()=>.5);active.aiConfig=config;active=apply(active,'human',{type:'START'});
  const original=globalThis.fetch;
  try{globalThis.fetch=async(url,options)=>{
    assert.ok(url.includes('gemini-3.5-flash-lite'));const body=JSON.parse(options.body);
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'MEDIUM');
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({type:'CHAT',text:'이번 팀의 선정 이유를 확인하겠습니다.',speechAct:'QUESTION',thinking:'모의 판단'})}]}}]})};
  };assert.equal((await decide(active,{type:'CHAT',actor:'ai1'},'mock')).action.type,'CHAT');}
  finally{globalThis.fetch=original;}
});
