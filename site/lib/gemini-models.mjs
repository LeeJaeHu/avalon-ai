export const GEMINI_MODEL_COMPARISON_VERSION='gemini-thinking-pair-v3';
export const GEMINI_GENERATION_VERSION='thinking-pair-v2';
export const GEMINI_THINKING_LEVELS={'gemini-3.5-flash-lite':'HIGH','gemini-3.5-flash':'MINIMAL'};
export const FIXED_MODEL_ASSIGNMENT_VERSION='fixed-lite-medium-v1';
export function fixedGameGeminiConfig(){return {model:'gemini-3.5-flash-lite',modelAssignmentVersion:FIXED_MODEL_ASSIGNMENT_VERSION,
  modelAssignmentProbability:1,geminiGenerationVersion:FIXED_MODEL_ASSIGNMENT_VERSION,thinkingLevel:'MEDIUM',maxOutputTokens:8192};}
export function newGameGeminiGeneration(model){
  newGameGeminiModel(model);
  return {geminiGenerationVersion:GEMINI_GENERATION_VERSION,thinkingLevel:GEMINI_THINKING_LEVELS[model],maxOutputTokens:8192};
}
export function geminiGeneration(config={}){
  if(!config.geminiGenerationVersion)return {maxOutputTokens:768};
  if(config.geminiGenerationVersion===FIXED_MODEL_ASSIGNMENT_VERSION){
    if(config.model!=='gemini-3.5-flash-lite'||config.thinkingLevel!=='MEDIUM'||config.maxOutputTokens!==8192)throw new Error('Gemini 생성 설정을 확인해 주세요.');
    return {maxOutputTokens:8192,thinkingConfig:{thinkingLevel:'MEDIUM'}};
  }
  const levels=config.geminiGenerationVersion==='thinking-pair-v1'?{'gemini-3.5-flash-lite':'MEDIUM','gemini-3.5-flash':'MINIMAL'}:config.geminiGenerationVersion===GEMINI_GENERATION_VERSION?GEMINI_THINKING_LEVELS:null;
  if(!levels||!Object.hasOwn(levels,config.model)||config.thinkingLevel!==levels[config.model]||config.maxOutputTokens!==8192)
    throw new Error('Gemini 생성 설정을 확인해 주세요.');
  return {maxOutputTokens:config.maxOutputTokens,thinkingConfig:{thinkingLevel:config.thinkingLevel}};
}
export const DEFAULT_GEMINI_MODEL='gemini-3.5-flash-lite';
export const GEMINI_MODELS={
  'gemini-3.5-flash-lite':{label:'Gemini 3.5 Flash-Lite',input:.30,output:2.50,cached:.03},
  'gemini-3.5-flash':{label:'Gemini 3.5 Flash',input:1.50,output:9.00,cached:.15},
};
export function newGameGeminiModel(model=DEFAULT_GEMINI_MODEL){
  if(typeof model!=='string'||!Object.hasOwn(GEMINI_MODELS,model))throw new Error('Gemini 모델을 확인해 주세요.');
  return model;
}
export function geminiModelId(model){
  // Response modelVersion may append a dated revision; never match another model family.
  const id=Object.keys(GEMINI_MODELS).find(id=>model===id||new RegExp(`^${id}-\\d`).test(model));
  return id??null;
}
export const geminiModelPricing=model=>GEMINI_MODELS[geminiModelId(model)]??null;

export const MODEL_ASSIGNMENT_VERSION='random-blind-thinking-v3';
export function randomGameGeminiModel(draw=()=>crypto.getRandomValues(new Uint32Array(1))[0]){
  const value=draw();
  if(!Number.isInteger(value)||value<0||value>0xffffffff)throw new Error('모델 배정 난수가 잘못됐습니다.');
  return value<0x80000000?'gemini-3.5-flash-lite':'gemini-3.5-flash';
}
export const isBlindModel=game=>['random-blind-v1','random-blind-thinking-v2',MODEL_ASSIGNMENT_VERSION].includes(game.aiConfig?.modelAssignmentVersion)&&!!game.aiConfig?.model;
export const modelHidden=game=>isBlindModel(game)&&!game.modelGuess;
export const modelGuessPending=game=>modelHidden(game)&&game.phase==='ENDED'&&['GOOD','EVIL'].includes(game.winner)&&game.endReason!=='RESTARTED';
export function submitModelGuess(game,actor,choice){
  if(actor!=='human'||!modelGuessPending(game))throw new Error('지금 모델 추측을 제출할 수 없습니다.');
  newGameGeminiModel(choice);
  if(choice===undefined)throw new Error('예상 모델을 선택해 주세요.');
  return {choice,correct:choice===game.aiConfig.model,actualModel:game.aiConfig.model,...(game.aiConfig.thinkingLevel?{actualThinkingLevel:game.aiConfig.thinkingLevel}:{}),version:game.aiConfig.modelAssignmentVersion,at:new Date().toISOString()};
}
