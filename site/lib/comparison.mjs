import {scoreRoleGuess} from './role-guess.mjs';
import {GEMINI_MODELS,GEMINI_MODEL_COMPARISON_VERSION,GEMINI_GENERATION_VERSION,GEMINI_THINKING_LEVELS} from './gemini-models.mjs';
export const COMPARISON_VERSION = 'gemini-jev-v1';
export const COMPARISON_MODES = {
  gemini: {label:'Gemini 단독',routingMode:'baseline',actionMode:'gemini'},
  hybrid: {label:'JEV + Gemini',routingMode:'jev',actionMode:'jev'},
};
export function comparisonMode(config = {}) {
  return Object.keys(COMPARISON_MODES).find(key => {
    const mode=COMPARISON_MODES[key];
    return mode.routingMode===(config.routingMode??'baseline') && mode.actionMode===(config.actionMode??'gemini');
  }) ?? 'custom';
}
export function comparisonPreset(mode) {
  if(typeof mode!=='string'||!Object.hasOwn(COMPARISON_MODES,mode))throw new Error('AI 비교 모드를 확인해 주세요.');
  const {routingMode,actionMode}=COMPARISON_MODES[mode];
  return {routingMode,actionMode};
}
const numeric=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
function summarize(rows) {
  const complete=rows.filter(r=>r.included),priced=complete.filter(r=>r.costComplete),latencies=complete.flatMap(r=>r.latencies);
  const guesses=complete.filter(r=>r.guessTotal!==null),total=guesses.reduce((n,r)=>n+r.guessTotal,0);
  const modelGuesses=complete.filter(r=>r.modelGuessCorrect!==null);
  const factionGuesses=complete.filter(r=>r.factionGuessTotal!==null),factionTotal=factionGuesses.reduce((n,r)=>n+r.factionGuessTotal,0);
  return {modelGuessGames:modelGuesses.length,modelGuessCorrect:modelGuesses.filter(r=>r.modelGuessCorrect).length,modelGuessAccuracy:modelGuesses.length?modelGuesses.filter(r=>r.modelGuessCorrect).length/modelGuesses.length:null,games:rows.length,completedGames:complete.length,excludedGames:rows.length-complete.length,
    goodWins:complete.filter(r=>r.winner==='GOOD').length,evilWins:complete.filter(r=>r.winner==='EVIL').length,
    goodWinRate:complete.length?complete.filter(r=>r.winner==='GOOD').length/complete.length:null,
    costCompleteGames:priced.length,meanCostUsd:mean(priced.map(r=>r.costUsd)),
    meanCalls:mean(complete.filter(r=>r.calls!==null).map(r=>r.calls)),
    latencySamples:latencies.length,meanCallLatencyMs:mean(latencies),
    recordedErrorCalls:complete.reduce((n,r)=>n+r.errorCalls,0),recordedFallbackEvents:complete.reduce((n,r)=>n+r.fallbackEvents,0),
    guessGames:guesses.length,guessCorrect:guesses.reduce((n,r)=>n+r.guessCorrect,0),guessTotal:total,
    guessAccuracy:total?guesses.reduce((n,r)=>n+r.guessCorrect,0)/total:null,
    factionGuessGames:factionGuesses.length,factionGuessCorrect:factionGuesses.reduce((n,r)=>n+r.factionGuessCorrect,0),factionGuessTotal:factionTotal,
    factionGuessAccuracy:factionTotal?factionGuesses.reduce((n,r)=>n+r.factionGuessCorrect,0)/factionTotal:null};
}
export function compareModelLogs(logs) {
  const seen=new Map(),rows=[];let duplicates=0;
  for(const log of logs) {
    const g=log?.game,c=g?.aiConfig??{};
    if(log?.format!=='avalon-game-log-v1'||typeof g?.id!=='string')throw new Error('종료 게임 로그 형식을 확인해 주세요.');
    // Export timestamps may differ; game state and call records must agree.
    const fingerprint=JSON.stringify([g,log.modelUsage,log.events]);
    if(seen.has(g.id)){if(seen.get(g.id)!==fingerprint)throw new Error('같은 게임의 서로 다른 로그가 있습니다. 최신 파일 하나만 선택해 주세요.');duplicates++;continue;}
    seen.set(g.id,fingerprint);
    const mode=comparisonMode(c),records=Array.isArray(log.modelUsage)?log.modelUsage:null;
    const exclusion=g.phase!=='ENDED'?'unfinished':g.endReason==='RESTARTED'?'restarted':!c.model?'practice':c.runtimeChanged?'runtime-updated':c.comparisonVersion!==COMPARISON_VERSION?'legacy':mode==='custom'?'custom':!['GOOD','EVIL'].includes(g.winner)?'no-result':null;
    const conditions={humanRoleMode:c.humanRoleMode??null,comparisonVersion:c.comparisonVersion??null,humanRole:g.roles?.human??null,players:Object.keys(g.roles??{}).length,
      modelComparisonVersion:c.modelComparisonVersion??null,modelAssignmentVersion:c.modelAssignmentVersion??null,
      pricingVersion:c.pricingVersion??null,geminiGenerationVersion:c.geminiGenerationVersion??null,thinkingLevel:c.thinkingLevel??null,maxOutputTokens:c.maxOutputTokens??null,
      model:c.model??null,promptVersion:c.promptVersion??null,policyVersion:c.policyVersion??null,proposalPolicy:c.proposalPolicy??null,
      conversationVersion:c.conversationVersion??null,manualProgress:c.manualProgress??null,roleGuessVersion:c.roleGuessVersion??null,assessmentVersion:c.assessmentVersion??null,assessmentPromptVersion:c.assessmentPromptVersion??null,assessmentScheduleVersion:c.assessmentScheduleVersion??null,
      roleGuessMetricVersion:g.roleGuess?.metricVersion??null,endgameExposureAllowed:c.endgameExposureAllowed??null,discussionPolicy:c.discussionPolicy??'moderator',playerDiscussionVersion:c.playerDiscussionVersion??null,
      routingVersion:c.routingVersion??null,routingModel:c.routingModel??null};
    const guess=g.roleGuess,validGuess=numeric(guess?.correct)&&numeric(guess?.total)&&guess.total>0&&guess.correct<=guess.total;
    const rescored=scoreRoleGuess(g.roles,guess?.guesses);
    const factionCorrect=rescored?.factionCorrect??guess?.factionCorrect,factionTotal=rescored?.factionTotal??guess?.factionTotal;
    const validFaction=numeric(factionCorrect)&&numeric(factionTotal)&&factionTotal>0&&factionCorrect<=factionTotal;
    rows.push({modelGuessChoice:g.modelGuess?.choice??null,modelGuessCorrect:g.modelGuess&&Object.hasOwn(GEMINI_MODELS,g.modelGuess.choice)?g.modelGuess.choice===c.model:null,gameId:g.id,mode,included:exclusion===null,exclusion,conditions,winner:g.winner??null,
      actionModel:c.actionModel??null,actionSelectionVersion:c.actionSelectionVersion??null,
      costComplete:!!records&&!!c.usageTrackingVersion&&records.every(r=>numeric(r.costUsd)),
      costUsd:records?records.reduce((n,r)=>n+(numeric(r.costUsd)?r.costUsd:0),0):null,calls:records?.length??null,
      latencies:(records??[]).map(r=>r.latencyMs).filter(numeric),errorCalls:(records??[]).filter(r=>r.errorCode||['ERROR','FALLBACK'].includes(r.status)).length,
      fallbackEvents:(log.events??[]).filter(e=>e.detail?.aiMode==='fallback'||e.detail?.mode==='fallback'||e.detail?.selection?.status==='FALLBACK'||e.detail?.routing?.status==='FALLBACK').length,
      guessCheckpoint:guess?.checkpoint??(guess?'legacy-unknown':null),
      guessCorrect:validGuess?guess.correct:null,guessTotal:validGuess?guess.total:null,
      factionGuessCorrect:validFaction?factionCorrect:null,factionGuessTotal:validFaction?factionTotal:null});
  }
  const groups=new Map();for(const row of rows){const key=JSON.stringify(row.conditions);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const modelRows=rows.map(row=>({...row,included:row.included&&row.mode==='hybrid'&&row.conditions.modelComparisonVersion===GEMINI_MODEL_COMPARISON_VERSION&&Object.hasOwn(GEMINI_MODELS,row.conditions.model)&&row.conditions.geminiGenerationVersion===GEMINI_GENERATION_VERSION&&row.conditions.thinkingLevel===GEMINI_THINKING_LEVELS[row.conditions.model]&&row.conditions.maxOutputTokens===8192}));
  const modelSummary=group=>Object.fromEntries(Object.keys(GEMINI_MODELS).map(model=>[model,summarize(group.filter(r=>r.conditions.model===model))]));
  const modelGroups=new Map();for(const row of modelRows){const {model,thinkingLevel,...conditions}=row.conditions;Object.assign(conditions,{actionModel:row.actionModel,actionSelectionVersion:row.actionSelectionVersion});const key=JSON.stringify(conditions);if(!modelGroups.has(key))modelGroups.set(key,{conditions,rows:[]});modelGroups.get(key).rows.push(row);}
  return {format:'avalon-model-comparison-v1',uniqueGames:rows.length,duplicates,
    byMode:Object.fromEntries(['gemini','hybrid','custom'].map(mode=>[mode,summarize(rows.filter(r=>r.mode===mode))])),
    byGeminiModel:modelSummary(modelRows),
    byGeminiModelConditions:[...modelGroups.values()].map(group=>({conditions:group.conditions,byModel:modelSummary(group.rows)})),
    byConditions:[...groups.values()].map(group=>({conditions:group[0].conditions,byMode:Object.fromEntries(['gemini','hybrid'].map(mode=>[mode,summarize(group.filter(r=>r.mode===mode))]))})),
    byHumanRole:Object.fromEntries(['MERLIN','LOYAL','ASSASSIN','MINION','unknown'].map(role=>[role,{byMode:Object.fromEntries(['gemini','hybrid','custom'].map(mode=>[mode,summarize(rows.filter(r=>(r.conditions.humanRole??'unknown')===role&&r.mode===mode))]))}])),
    byCheckpoint:Object.fromEntries([...new Set(rows.map(r=>r.guessCheckpoint??'not-submitted'))].map(checkpoint=>[checkpoint,{byMode:Object.fromEntries(['gemini','hybrid','custom'].map(mode=>[mode,summarize(rows.filter(r=>(r.guessCheckpoint??'not-submitted')===checkpoint&&r.mode===mode))]))}])),
    games:rows.map(({latencies,...row})=>({...row,latencySamples:latencies.length})),
    limits:['모델 식별률은 추측 제출 완료 판만 집계합니다. 높은 정답률은 식별 가능성이지 품질 우위를 뜻하지 않습니다. 수동/무작위 배정은 byGeminiModelConditions에서 분리합니다.',
      '완료 통계는 이 비교 버전의 실제 모델 판만 포함합니다. 과거/연습/재시작/사용자 설정 판은 제외합니다.',
      'Gemini 단독은 발언자 선택에 기존 규칙을 사용합니다. 두 구성의 시스템 비교이며 모델 하나의 인과 효과가 아닙니다.',
      'byGeminiModel은 기존 gemini-thinking-pair-v3의 JEV 혼합 판만 포함합니다. Flash-Lite/HIGH 대 Flash/MINIMAL 조합 비교이며 모델만의 효과가 아닙니다. 새 Flash-Lite/MEDIUM 고정 판은 이 집계에서 제외합니다. 시작 역할/공통 조건은 byGeminiModelConditions에서 확인하세요.',
      '전체 평균보다 같은 조건과 사용자 역할의 표본수를 먼저 확인하세요. 역할 배정·대화·사용자 경험은 판마다 다릅니다.',
      '비용 평균은 사용량 비용이 모두 확인된 판만 포함하며 USD 추정치입니다. 오류·재시도 호출도 포함됩니다.',
      '지연은 기록된 개별 API 호출의 평균입니다. 사용자 체감 대기 시간이나 한 판 소요 시간이 아닙니다.',
      'guessAccuracy는 세부 역할, factionGuessAccuracy는 진영 식별입니다. 추측 제출 판만 집계하며 null은 미확인입니다.',
      '정답률 하락은 사용자 식별 난이도/은폐의 대리 지표이며 승률과 별도로 봅니다. 시작 정보와 사용자 경험도 영향을 줍니다.',
      '종료 경로별 집단은 실험 결과로 결정되므로 경로별 차이를 인과 효과로 해석하지 않습니다.']};
}
