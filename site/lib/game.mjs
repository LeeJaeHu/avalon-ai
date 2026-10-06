import { progressOptions,GRACE_MS,manualNextStep } from './conversation.mjs';
import { roleGuessPending, submitRoleGuess } from './role-guess.mjs';
import { publicRoleCounts } from './role-guide.mjs';
export const IDS = ['human', 'ai1', 'ai2', 'ai3', 'ai4'];
export const NAMES = { human: '유저', ai1: '하린', ai2: '도윤', ai3: '서아', ai4: '지호' };
export const SIZES = [2, 3, 2, 3, 3];
export const ROLES = ['MERLIN', 'LOYAL', 'LOYAL', 'ASSASSIN', 'MINION'];
export const SPEECH_ACTS = ['QUESTION', 'ANSWER', 'TEAM_SUGGESTION', 'CHALLENGE', 'DEFENSE', 'EVIDENCE', 'OTHER'];
const evil = role => role === 'ASSASSIN' || role === 'MINION';
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };

export function createGame(random = Math.random) {
  const shuffled = [...ROLES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { id: crypto.randomUUID(), version: 0, phase: 'ROLE_REVEAL', quest: 0, attempt: 1,
    leader: IDS[Math.floor(random() * 5)], roles: Object.fromEntries(IDS.map((id, i) => [id, shuffled[i]])),
    proposals: [], quests: [], messages: [], team: null, votes: {}, cards: {}, privateCards: [], winner: null, paused: false, pausedAt: null,
    publicEvents: [], revisionRequested: false,
    pendingSpeech: null, pendingDiscussion: null, idleCount: 0,
    lastDiscussionAt: new Date().toISOString(), createdAt: new Date().toISOString() };
}

export function observe(game, actor = 'human') {
  const role = game.roles[actor];
  const known = role === 'MERLIN' ? IDS.filter(id => evil(game.roles[id]))
    : evil(role) ? IDS.filter(id => id !== actor && evil(game.roles[id])) : [];
  const current = game.proposals.at(-1);
  const view = { id: game.id, version: game.version, phase: game.phase, quest: game.quest + 1,
    size: SIZES[game.quest] ?? 0, attempt: game.attempt, leader: game.leader, team: game.team,
      role, known, roleCounts: publicRoleCounts(game.roles), names: NAMES, ids: IDS, publicEvents: game.publicEvents ?? [], revisionRequested: !!game.revisionRequested, proposals: game.proposals.map(p => ['DRAFT', 'VOTING'].includes(p.status)
      ? { id: p.id, quest: p.quest, attempt: p.attempt, leader: p.leader, team: p.team, status: p.status }
      : p), quests: game.quests, messages: game.messages,
    voted: Object.hasOwn(game.votes, actor), cardSubmitted: Object.hasOwn(game.cards, actor),
    winner: game.winner, paused: !!game.paused,pausedAt:game.pausedAt??null,pauseSource:game.pauseSource??'manual',
    currentProposalId: current?.id ?? null,
    ...(game.aiConfig?.conversationVersion?{conversation:{voteAt:game.conversation?.voteAt??null,continueAt:game.conversation?.continueAt??null,burst:game.conversation?.burst??0},conversationVersion:1}:{}) };
  if (actor === 'human' && game.aiConfig?.roleGuessVersion) view.roleGuess = game.phase === 'ENDED' ? (game.roleGuess ?? null) : { pending: roleGuessPending(game), submitted: !!game.roleGuess };
  if (game.phase === 'ENDED') view.roles = game.roles;
  if (game.phase === 'ENDED' && game.assassination) view.assassination = game.assassination;
  return view;
}

export function observeModerator(game) {
  const { role, known, roles, voted, cardSubmitted, roleGuess, ...publicView } = observe(game);
  return publicView;
}

export function apply(game, actor, action) {
  const type = action?.type;
  if(game.aiConfig?.manualProgress&&['ANNOUNCE_VOTE','ANNOUNCE_CONTINUE'].includes(type))throw new Error('다음 단계는 버튼으로 이동해 주세요.');
  if(game.aiConfig?.manualProgress&&['START_VOTE','CONTINUE'].includes(type)) {
    const step=manualNextStep(game);
    requireThat(actor==='human'&&!step.disabled&&step.type===type,step.reason??'지금 다음 단계로 이동할 수 없습니다.');
  }
  const facilitated=!!game.aiConfig?.conversationVersion;
  requireThat(IDS.includes(actor) || (actor === 'system' && (type==='SILENCE'||(facilitated&&['ANNOUNCE_VOTE','ANNOUNCE_CONTINUE','START_VOTE','REQUEST_REVISION','CONTINUE'].includes(type)))), '알 수 없는 플레이어입니다.');
  requireThat(game.phase !== 'ENDED', '이미 종료된 게임입니다.');
  const next = structuredClone(game);
  if(facilitated)next.conversation??={burst:0,turns:0,revisions:0,voteAt:null,deferUntil:null};
  const c=next.conversation;
  if(action.skipWaitAt!==undefined){
    const deadline=type==='START_VOTE'?c?.voteAt:type==='CONTINUE'?c?.continueAt:null;
    requireThat(actor==='human'&&facilitated&&!!deadline&&deadline===action.skipWaitAt,'이동 예고가 변경됐습니다. 현재 상태를 확인해 주세요.');
  }
  const event = (kind, text) => {
    next.publicEvents ??= [];
    next.publicEvents.push({ id: `event-${next.version + 1}`, kind, text, at: new Date().toISOString(), version: next.version + 1 });
  };
  if (type === 'PAUSE') {
    if(actor==='human'&&action.readingAuto&&next.paused)return game;
    requireThat(actor === 'human' && !next.paused, '이미 일시정지 중입니다.');
    next.paused = true;
    next.pauseSource=action.readingAuto?'reading':'manual';
    next.pausedAt = Date.now();
  } else if (type === 'RESUME') {
    if(actor==='human'&&action.readingAuto&&(!next.paused||next.pauseSource!=='reading'))return game;
    requireThat(actor === 'human' && next.paused, '일시정지 중이 아닙니다.');
    const elapsed = Date.now() - (next.pausedAt ?? Date.now());
    next.lastDiscussionAt = new Date(Date.parse(next.lastDiscussionAt ?? next.createdAt) + elapsed).toISOString();
      if (facilitated) {
        if (c.voteAt) c.voteAt += elapsed;
        if (c.continueAt) c.continueAt += elapsed;
        if (c.deferUntil) c.deferUntil += elapsed;
      }
    next.paused = false;
    next.pausedAt = null;
    next.pauseSource=null;
  } else if (next.paused) {
    throw new Error('게임이 일시정지 중입니다.');
  } else if (type === 'ROLE_GUESS') {
    next.roleGuess = submitRoleGuess(game, actor, action.guesses);
  } else if (roleGuessPending(game)) {
    throw new Error('마지막 선택 전에 플레이어들의 역할을 추측해 주세요.');
  } else if (type==='HUMAN_ACTIVE'||type==='DEFER_VOTE') {
    requireThat(facilitated&&actor==='human'&&['PROPOSE','TEAM_DISCUSSION','VOTE_RESULT','QUEST_RESULT'].includes(next.phase),'지금 대화를 이어갈 수 없습니다.');
    c.voteAt=null;c.continueAt=null;c.deferUntil=Date.now()+20000;next.pendingDiscussion=null;next.pendingSpeech=null;next.idleCount=0;
    if(type==='DEFER_VOTE')event('DISCUSSION','추가 대화를 위해 진행을 잠시 미룹니다.');
  } else if(type==='ANNOUNCE_VOTE'){
    requireThat(actor==='system'&&progressOptions(game).includes('OPEN_VOTE'),'지금 투표를 예고할 수 없습니다.');
    c.voteAt=Date.now()+GRACE_MS;c.deferUntil=null;next.pendingDiscussion=null;next.pendingSpeech=null;
    event('DISCUSSION',`진행자: 추가 의견 없으면 다음 단계로 넘어갑니다. ${next.team.map(id=>NAMES[id]).join(' · ')} 팀으로 투표합니다.`);
  } else if(type==='ANNOUNCE_CONTINUE'){
    requireThat(actor==='system'&&progressOptions(game).includes('CONTINUE'),'지금 다음 단계를 예고할 수 없습니다.');
    c.continueAt=Date.now()+GRACE_MS;c.deferUntil=null;next.pendingDiscussion=null;next.pendingSpeech=null;
    event('DISCUSSION','진행자: 추가 의견 없으면 다음 단계로 넘어갑니다.');
  } else if (type === 'START') {
    requireThat(actor === 'human' && next.phase === 'ROLE_REVEAL', '역할 확인 단계가 아닙니다.');
    next.phase = 'PROPOSE';
    next.pendingDiscussion = 'start';
  } else if (type === 'CHAT') {
    requireThat(next.phase !== 'ROLE_REVEAL', '역할을 확인한 뒤 대화를 시작하세요.');
    const text = String(action.text ?? '').trim();
    requireThat(text.length > 0 && text.length <= 280, '채팅은 1~280자여야 합니다.');
    requireThat(SPEECH_ACTS.includes(action.speechAct), '발언 유형이 잘못됐습니다.');
    const replyTo = action.replyTo ?? null;
    requireThat(replyTo === null || next.messages.some(m => m.id === replyTo), '답할 메시지가 없습니다.');
    next.messages.push({ id: `msg-${next.messages.length + 1}`, actor, text, replyTo,
      speechAct: action.speechAct, at: new Date().toISOString() });
    next.pendingSpeech = actor === 'human' ? next.messages.at(-1).id : null;
    if (actor === 'human') {
      next.pendingDiscussion = next.pendingSpeech;
      if(facilitated){c.burst=0;c.voteAt=null;c.continueAt=null;c.deferUntil=null;next.idleCount=0;}
    } else {
      if (action.idleTrigger) next.idleCount = (next.idleCount ?? 0) + 1;
      next.pendingDiscussion = null;
      if(facilitated){c.burst++;c.turns++;if(['TEAM_DISCUSSION','VOTE_RESULT','QUEST_RESULT'].includes(next.phase)&&!action.practiceStop){next.pendingDiscussion='followup';next.pendingSpeech=next.messages.at(-1).id;}}
    }
  } else if (type === 'SILENCE') {
    requireThat(actor === 'system' && (next.pendingDiscussion || action.idleTrigger), '발언을 기다리는 중이 아닙니다.');
    if (action.idleTrigger) next.idleCount = (next.idleCount ?? 0) + 1;
    next.pendingSpeech = null;
    next.pendingDiscussion = null;
    if(facilitated)c.burst=3;
  } else if (type === 'PROPOSE') {
    requireThat(['PROPOSE', 'TEAM_DISCUSSION'].includes(next.phase) && next.leader === actor, '지금 팀을 제안할 수 없습니다.');
    requireThat(Array.isArray(action.team) && action.team.length === SIZES[next.quest]
      && new Set(action.team).size === action.team.length && action.team.every(id => IDS.includes(id)), '팀 인원이 맞지 않습니다.');
    next.team = [...action.team]; next.votes = {};
    const revised = next.phase === 'TEAM_DISCUSSION';
    if (revised) next.proposals.at(-1).team = next.team;
    else next.proposals.push({ id: `proposal-${next.proposals.length + 1}`, quest: next.quest + 1,
      attempt: next.attempt, leader: actor, team: next.team, status: 'DRAFT' });
    next.phase = 'TEAM_DISCUSSION';
    next.revisionRequested = false;
    next.idleCount = 0;
    next.pendingDiscussion = next.proposals.at(-1).id;
    if(facilitated){c.turns=0;c.burst=0;c.voteAt=null;c.deferUntil=null;if(!revised)c.revisions=0;}
    event('TEAM', `${NAMES[actor]}의 ${revised ? '수정' : '팀 초안'} · ${next.team.map(id => NAMES[id]).join(' · ')}. 아직 투표 전입니다.`);
  } else if (type === 'REQUEST_REVISION') {
    requireThat((actor==='human'||(actor==='system'&&progressOptions(game).includes('REVISE'))) && next.phase === 'TEAM_DISCUSSION' && next.leader !== 'human' && !next.revisionRequested, '지금 팀 재검토를 요청할 수 없습니다.');
    next.revisionRequested = true;
    next.pendingDiscussion=null;next.pendingSpeech=null;if(facilitated){c.revisions++;c.voteAt=null;}
    event('DISCUSSION', `${NAMES[next.leader]}에게 대화를 바탕으로 팀 재검토를 요청했습니다.`);
  } else if (type === 'START_VOTE') {
    requireThat((actor==='human'||(actor==='system'&&c?.voteAt&&Date.now()>=c.voteAt)) && next.phase === 'TEAM_DISCUSSION' && !next.revisionRequested, '지금 투표를 시작할 수 없습니다.');
    if(facilitated){c.voteAt=null;c.deferUntil=null;c.burst=0;}
    next.proposals.at(-1).status = 'VOTING';
    next.pendingDiscussion = null;
    next.pendingSpeech = null;
    next.phase = 'VOTE';
    event('VOTE_START', `${next.team.map(id => NAMES[id]).join(' · ')} 팀으로 투표를 시작합니다. 명단은 이제 확정됐습니다.`);
  } else if (type === 'VOTE') {
    requireThat(next.phase === 'VOTE' && !Object.hasOwn(next.votes, actor), '지금 투표할 수 없습니다.');
    requireThat(['APPROVE', 'REJECT'].includes(action.choice), '잘못된 투표입니다.');
    next.votes[actor] = action.choice;
    if (Object.keys(next.votes).length === 5) {
      const p = next.proposals.at(-1);
      p.votes = IDS.map(id => ({ actor: id, choice: next.votes[id] }));
      p.approveCount = p.votes.filter(v => v.choice === 'APPROVE').length;
      p.status = p.approveCount >= 3 ? 'APPROVED' : 'REJECTED';
      next.phase = 'VOTE_RESULT';
      if(game.aiConfig?.manualProgress){c.burst=0;c.turns=0;next.pendingDiscussion='result';next.pendingSpeech=null;}
      event('VOTE_RESULT', `원정팀 ${p.status === 'APPROVED' ? '승인' : '부결'} · 찬성 ${p.approveCount}명. ${p.votes.map(v => `${NAMES[v.actor]} ${v.choice === 'APPROVE' ? '찬성' : '반대'}`).join(' · ')}`);
    }
  } else if (type === 'CARD') {
    requireThat(next.phase === 'QUEST' && next.team.includes(actor) && !Object.hasOwn(next.cards, actor), '지금 임무 카드를 낼 수 없습니다.');
    requireThat(['SUCCESS', 'FAIL'].includes(action.choice) && (evil(next.roles[actor]) || action.choice === 'SUCCESS'), '허용되지 않는 카드입니다.');
    next.cards[actor] = action.choice;
    next.privateCards ??= [];
    next.privateCards.push({ quest: next.quest + 1, actor, choice: action.choice });
    if (Object.keys(next.cards).length === next.team.length) {
      const fails = Object.values(next.cards).filter(x => x === 'FAIL').length;
      next.quests.push({ id: `quest-${next.quest + 1}`, proposalId: next.proposals.at(-1).id,
        team: next.team, fails, result: fails ? 'FAIL' : 'SUCCESS' });
      next.phase = 'QUEST_RESULT';
      if(game.aiConfig?.manualProgress){c.burst=0;c.turns=0;next.pendingDiscussion='result';next.pendingSpeech=null;}
      event('QUEST_RESULT', `${next.quest + 1}번째 원정 ${fails ? '실패' : '성공'} · ${next.team.map(id => NAMES[id]).join(' · ')} · 실패 카드 ${fails}장`);
      next.cards = {};
    }
  } else if (type === 'CONTINUE') {
    requireThat((actor==='human'||(actor==='system'&&facilitated&&c?.continueAt&&Date.now()>=c.continueAt)) && ['VOTE_RESULT', 'QUEST_RESULT'].includes(next.phase), '확인할 결과가 없습니다.');
    next.pendingDiscussion=null;next.pendingSpeech=null;if(facilitated){c.burst=0;c.turns=0;c.deferUntil=null;c.voteAt=null;c.continueAt=null;}
    if (next.phase === 'VOTE_RESULT') {
      const approved = next.proposals.at(-1).status === 'APPROVED';
      if (approved) { next.phase = 'QUEST'; next.cards = {}; }
      else if (next.attempt === 5) { next.phase = 'ENDED'; next.winner = 'EVIL'; }
      else { next.phase = 'PROPOSE'; next.attempt++; next.leader = IDS[(IDS.indexOf(next.leader) + 1) % 5]; next.team = null; }
    } else {
      const wins = next.quests.filter(q => q.result === 'SUCCESS').length;
      const losses = next.quests.length - wins;
      if (losses === 3) { next.phase = 'ENDED'; next.winner = 'EVIL'; }
      else if (wins === 3) next.phase = 'ASSASSINATE';
      else { next.quest++; next.attempt = 1; next.leader = IDS[(IDS.indexOf(next.leader) + 1) % 5]; next.phase = 'PROPOSE'; next.team = null; next.pendingDiscussion = next.quests.at(-1).id; }
    }
  } else if (type === 'ASSASSINATE') {
    requireThat(next.phase === 'ASSASSINATE' && next.roles[actor] === 'ASSASSIN', '암살자가 아닙니다.');
    requireThat(IDS.includes(action.target) && action.target !== actor, '대상이 잘못되었습니다.');
    next.assassination = action.target;
    next.winner = next.roles[action.target] === 'MERLIN' ? 'EVIL' : 'GOOD';
    next.phase = 'ENDED';
  } else throw new Error('알 수 없는 행동입니다.');
  if (next.phase !== game.phase || next.quest !== game.quest || next.attempt !== game.attempt) next.idleCount = 0;
  if (type === 'CHAT' || type === 'SILENCE' || next.phase !== game.phase || next.quest !== game.quest || next.attempt !== game.attempt)
    next.lastDiscussionAt = new Date().toISOString();
  next.version++;
  return next;
}
