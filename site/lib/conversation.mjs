import { roleGuessPending } from './role-guess.mjs';
export const CONVERSATION_VERSION=1;
export const GRACE_MS=8000;
export function manualNextStep(game, {busy=false,aiBusy=false,draft=false,teamChanged=false}={}) {
  const type=game.phase==='ROLE_REVEAL'?'START':game.phase==='TEAM_DISCUSSION'?'START_VOTE':['VOTE_RESULT','QUEST_RESULT'].includes(game.phase)?'CONTINUE':null;
  const label=game.phase==='ROLE_REVEAL'?'게임 시작 →':game.phase==='TEAM_DISCUSSION'?'이 팀으로 투표 →':game.phase==='VOTE_RESULT'?(game.proposals.at(-1)?.status==='APPROVED'?'원정 출발 →':'다음 리더로 →'):game.phase==='QUEST_RESULT'?'결과 확인하고 계속 →':'다음 단계 →';
  const reason=game.phase==='ENDED'?'게임이 종료됐습니다.':game.paused?'일시정지를 해제해 주세요.':busy?'요청을 처리하고 있습니다.':draft?'작성 중인 메시지를 보내거나 지워 주세요.':teamChanged?'수정한 팀을 먼저 공유해 주세요.':game.revisionRequested?'리더가 팀을 다시 검토하고 있습니다.':aiBusy||game.aiPending||game.pendingDiscussion||game.pendingSpeech?'AI가 대화하거나 다음 응답을 준비하고 있습니다.':game.phase==='PROPOSE'?'팀 초안을 먼저 공유해 주세요.':game.phase==='VOTE'?'모든 참가자의 찬반 투표를 기다립니다.':game.phase==='QUEST'?'원정팀의 성공 여부 투표를 기다립니다.':game.phase==='ASSASSINATE'?'암살자의 선택을 기다립니다.':null;
  const guessPending=game.roleGuess?.pending||roleGuessPending(game);
  return {type,label,reason:guessPending?'플레이어들의 역할 추측을 먼저 제출해 주세요.':reason,disabled:!type||!!reason||!!guessPending};
}
export function humanNeedsReply(game) {
  return game.messages.find(m=>m.id===game.pendingSpeech)?.actor==='human';
}
export function progressOptions(game) {
  const options=['TALK','WAIT'];
  if(!game.aiConfig?.conversationVersion)return options;
  const c=game.conversation??{};
  const unanswered=humanNeedsReply(game);
  if(game.phase==='TEAM_DISCUSSION'&&game.team&&!game.revisionRequested&&!unanswered&&(c.turns??0)>=2){
    options.push('OPEN_VOTE');
    if(game.leader!=='human'&&(c.revisions??0)<1)options.push('REVISE');
  }
  if(['VOTE_RESULT','QUEST_RESULT'].includes(game.phase)&&!unanswered)options.push('CONTINUE');
  return options;
}
export function conversationDueAt(game) {
  if(game.aiConfig?.manualProgress)return null;
  if(!game.aiConfig?.conversationVersion||game.paused||['ROLE_REVEAL','ENDED'].includes(game.phase))return null;
  const c=game.conversation??{};
  if(c.voteAt)return c.voteAt;
  if(c.continueAt)return c.continueAt;
  if(['VOTE_RESULT','QUEST_RESULT'].includes(game.phase))return Math.max(Date.parse(game.lastDiscussionAt??game.createdAt),c.deferUntil??0)+GRACE_MS;
  if(game.pendingDiscussion||game.pendingSpeech||game.revisionRequested)return null;
  if(game.phase==='TEAM_DISCUSSION'||(game.phase==='PROPOSE'&&(game.idleCount??0)<2))return Math.max(Date.parse(game.lastDiscussionAt??game.createdAt)+12000,c.deferUntil??0);
  return null;
}
export function conversationAction(game,now) {
  if(game.aiConfig?.manualProgress)return undefined;
  if(!game.aiConfig?.conversationVersion)return undefined;
  const c=game.conversation??{};
  if(c.deferUntil>now&&['PROPOSE','TEAM_DISCUSSION','VOTE_RESULT','QUEST_RESULT'].includes(game.phase))return null;
  if(c.voteAt)return now>=c.voteAt?{actor:'system',type:'START_VOTE'}:null;
  if(c.continueAt)return now>=c.continueAt?{actor:'system',type:'CONTINUE'}:null;
  const due=conversationDueAt(game);
  if((game.idleCount??0)>=2&&due!==null&&now>=due){
    const allowed=progressOptions(game);
    if(allowed.includes('OPEN_VOTE'))return {actor:'system',type:'ANNOUNCE_VOTE',recoveryReason:'WAIT_LIMIT'};
    if(allowed.includes('CONTINUE'))return {actor:'system',type:'ANNOUNCE_CONTINUE',recoveryReason:'WAIT_LIMIT'};
    if(game.phase==='TEAM_DISCUSSION')return {type:'DISCUSS',topic:'recovery',replyTo:game.pendingSpeech??null,idleTrigger:true,recoveryReason:'WAIT_LIMIT'};
  }
  if(['VOTE_RESULT','QUEST_RESULT'].includes(game.phase)){
    const due=conversationDueAt(game);if(due===null||now<due)return null;
    return {type:'DISCUSS',topic:'result',replyTo:game.pendingSpeech??null,idleTrigger:!game.pendingDiscussion};
  }
  return undefined;
}
export function progressDecision(game,record) {
  if(game.aiConfig?.manualProgress)return null;
  if(!game.aiConfig?.conversationVersion)return null;
  const allowed=progressOptions(game);
  // WAIT controls stage timing, not whether the selected AI answers a person.
  if(humanNeedsReply(game))return null;
  if(record.status==='OK'&&allowed.includes(record.progress)){
    const types={OPEN_VOTE:'ANNOUNCE_VOTE',REVISE:'REQUEST_REVISION',CONTINUE:'ANNOUNCE_CONTINUE'};
    if(types[record.progress])return {actor:'system',action:{type:types[record.progress]},mode:'jev-progress'};
  }
  if((game.idleCount??0)>=2){
    const type=allowed.includes('OPEN_VOTE')?'ANNOUNCE_VOTE':allowed.includes('CONTINUE')?'ANNOUNCE_CONTINUE':null;
    if(type){record.recoveryReason='WAIT_LIMIT';return {actor:'system',action:{type},mode:'automatic-recovery'};}
    if(game.phase==='TEAM_DISCUSSION'&&(game.conversation?.turns??0)<2)return null;
  }
  if((record.progress==='WAIT'&&record.selectedActor==='WAIT')||(game.conversation?.burst??0)>=3||(['VOTE_RESULT','QUEST_RESULT'].includes(game.phase)&&record.status!=='OK'))
    return {actor:'system',action:{type:'SILENCE',idleTrigger:true},mode:record.status==='OK'?'jev-wait':'fallback'};
  return null;
}
