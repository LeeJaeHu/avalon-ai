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
  return {games:rows.length,completedGames:complete.length,excludedGames:rows.length-complete.length,
    goodWins:complete.filter(r=>r.winner==='GOOD').length,evilWins:complete.filter(r=>r.winner==='EVIL').length,
    goodWinRate:complete.length?complete.filter(r=>r.winner==='GOOD').length/complete.length:null,
    costCompleteGames:priced.length,meanCostUsd:mean(priced.map(r=>r.costUsd)),
    meanCalls:mean(complete.filter(r=>r.calls!==null).map(r=>r.calls)),
    latencySamples:latencies.length,meanCallLatencyMs:mean(latencies),
    recordedErrorCalls:complete.reduce((n,r)=>n+r.errorCalls,0),recordedFallbackEvents:complete.reduce((n,r)=>n+r.fallbackEvents,0),
    guessGames:guesses.length,guessCorrect:guesses.reduce((n,r)=>n+r.guessCorrect,0),guessTotal:total,
    guessAccuracy:total?guesses.reduce((n,r)=>n+r.guessCorrect,0)/total:null};
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
    const exclusion=g.phase!=='ENDED'?'unfinished':g.endReason==='RESTARTED'?'restarted':!c.model?'practice':c.comparisonVersion!==COMPARISON_VERSION?'legacy':mode==='custom'?'custom':!['GOOD','EVIL'].includes(g.winner)?'no-result':null;
    const conditions={comparisonVersion:c.comparisonVersion??null,humanRole:g.roles?.human??null,players:Object.keys(g.roles??{}).length,
      model:c.model??null,promptVersion:c.promptVersion??null,policyVersion:c.policyVersion??null,proposalPolicy:c.proposalPolicy??null,
      conversationVersion:c.conversationVersion??null,manualProgress:c.manualProgress??null,roleGuessVersion:c.roleGuessVersion??null,
      routingVersion:c.routingVersion??null,routingModel:c.routingModel??null};
    const guess=g.roleGuess,validGuess=numeric(guess?.correct)&&numeric(guess?.total)&&guess.total>0&&guess.correct<=guess.total;
    rows.push({gameId:g.id,mode,included:exclusion===null,exclusion,conditions,winner:g.winner??null,
      actionModel:c.actionModel??null,actionSelectionVersion:c.actionSelectionVersion??null,
      costComplete:!!records&&!!c.usageTrackingVersion&&records.every(r=>numeric(r.costUsd)),
      costUsd:records?records.reduce((n,r)=>n+(numeric(r.costUsd)?r.costUsd:0),0):null,calls:records?.length??null,
      latencies:(records??[]).map(r=>r.latencyMs).filter(numeric),errorCalls:(records??[]).filter(r=>r.errorCode||['ERROR','FALLBACK'].includes(r.status)).length,
      fallbackEvents:(log.events??[]).filter(e=>e.detail?.aiMode==='fallback'||e.detail?.mode==='fallback'||e.detail?.selection?.status==='FALLBACK'||e.detail?.routing?.status==='FALLBACK').length,
      guessCorrect:validGuess?guess.correct:null,guessTotal:validGuess?guess.total:null});
  }
  const groups=new Map();for(const row of rows){const key=JSON.stringify(row.conditions);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  return {format:'avalon-model-comparison-v1',uniqueGames:rows.length,duplicates,
    byMode:Object.fromEntries(['gemini','hybrid','custom'].map(mode=>[mode,summarize(rows.filter(r=>r.mode===mode))])),
    byConditions:[...groups.values()].map(group=>({conditions:group[0].conditions,byMode:Object.fromEntries(['gemini','hybrid'].map(mode=>[mode,summarize(group.filter(r=>r.mode===mode))]))})),
    games:rows.map(({latencies,...row})=>({...row,latencySamples:latencies.length})),
    limits:['완료 통계는 이 비교 버전의 실제 모델 판만 포함합니다. 과거/연습/재시작/사용자 설정 판은 제외합니다.',
      'Gemini 단독은 발언자 선택에 기존 규칙을 사용합니다. 두 구성의 시스템 비교이며 모델 하나의 인과 효과가 아닙니다.',
      '전체 평균보다 같은 조건과 사용자 역할의 표본수를 먼저 확인하세요. 역할 배정·대화·사용자 경험은 판마다 다릅니다.',
      '비용 평균은 사용량 비용이 모두 확인된 판만 포함하며 USD 추정치입니다. 오류·재시도 호출도 포함됩니다.',
      '지연은 기록된 개별 API 호출의 평균입니다. 사용자 체감 대기 시간이나 한 판 소요 시간이 아닙니다.',
      '역할 추측은 제출한 판만 집계합니다. 정답률이 높다는 사실만으로 AI 전체 품질이 좋다고 해석하지 않습니다.']};
}
