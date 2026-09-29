export const IDS = ['human', 'ai1', 'ai2', 'ai3', 'ai4'];
export const NAMES = { human: '나', ai1: '하린', ai2: '도윤', ai3: '서아', ai4: '지호' };
export const SIZES = [2, 3, 2, 3, 3];
export const ROLES = ['MERLIN', 'LOYAL', 'LOYAL', 'ASSASSIN', 'MINION'];
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
    proposals: [], quests: [], messages: [], team: null, votes: {}, cards: {}, privateCards: [], winner: null,
    pendingSpeech: null, createdAt: new Date().toISOString() };
}

export function observe(game, actor = 'human') {
  const role = game.roles[actor];
  const known = role === 'MERLIN' ? IDS.filter(id => evil(game.roles[id]))
    : evil(role) ? IDS.filter(id => id !== actor && evil(game.roles[id])) : [];
  const current = game.proposals.at(-1);
  const view = { id: game.id, version: game.version, phase: game.phase, quest: game.quest + 1,
    size: SIZES[game.quest] ?? 0, attempt: game.attempt, leader: game.leader, team: game.team,
    role, known, names: NAMES, ids: IDS, proposals: game.proposals.map(p => p.status === 'VOTING'
      ? { id: p.id, quest: p.quest, attempt: p.attempt, leader: p.leader, team: p.team, status: p.status }
      : p), quests: game.quests, messages: game.messages,
    voted: Object.hasOwn(game.votes, actor), cardSubmitted: Object.hasOwn(game.cards, actor),
    winner: game.winner,
    currentProposalId: current?.id ?? null };
  if (game.phase === 'ENDED') view.roles = game.roles;
  if (game.phase === 'ENDED' && game.assassination) view.assassination = game.assassination;
  return view;
}

export function observeModerator(game) {
  const { role, known, roles, voted, cardSubmitted, ...publicView } = observe(game);
  return publicView;
}

export function apply(game, actor, action) {
  requireThat(IDS.includes(actor), '알 수 없는 플레이어입니다.');
  requireThat(game.phase !== 'ENDED', '이미 종료된 게임입니다.');
  const next = structuredClone(game);
  const type = action?.type;
  if (type === 'START') {
    requireThat(actor === 'human' && next.phase === 'ROLE_REVEAL', '역할 확인 단계가 아닙니다.');
    next.phase = 'PROPOSE';
  } else if (type === 'CHAT') {
    requireThat(next.phase !== 'ROLE_REVEAL', '역할을 확인한 뒤 대화를 시작하세요.');
    const text = String(action.text ?? '').trim();
    requireThat(text.length > 0 && text.length <= 280, '채팅은 1~280자여야 합니다.');
    next.messages.push({ id: `msg-${next.messages.length + 1}`, actor, text, at: new Date().toISOString() });
    next.pendingSpeech = actor === 'human' ? next.messages.at(-1).id : null;
  } else if (type === 'PROPOSE') {
    requireThat(next.phase === 'PROPOSE' && next.leader === actor, '지금 팀을 제안할 수 없습니다.');
    requireThat(Array.isArray(action.team) && action.team.length === SIZES[next.quest]
      && new Set(action.team).size === action.team.length && action.team.every(id => IDS.includes(id)), '팀 인원이 맞지 않습니다.');
    next.team = [...action.team]; next.votes = {};
    next.proposals.push({ id: `proposal-${next.proposals.length + 1}`, quest: next.quest + 1,
      attempt: next.attempt, leader: actor, team: next.team, status: 'VOTING' });
    next.phase = 'VOTE';
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
      next.cards = {};
    }
  } else if (type === 'CONTINUE') {
    requireThat(actor === 'human' && ['VOTE_RESULT', 'QUEST_RESULT'].includes(next.phase), '확인할 결과가 없습니다.');
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
      else { next.quest++; next.attempt = 1; next.leader = IDS[(IDS.indexOf(next.leader) + 1) % 5]; next.phase = 'PROPOSE'; next.team = null; }
    }
  } else if (type === 'ASSASSINATE') {
    requireThat(next.phase === 'ASSASSINATE' && next.roles[actor] === 'ASSASSIN', '암살자가 아닙니다.');
    requireThat(IDS.includes(action.target) && action.target !== actor, '대상이 잘못되었습니다.');
    next.assassination = action.target;
    next.winner = next.roles[action.target] === 'MERLIN' ? 'EVIL' : 'GOOD';
    next.phase = 'ENDED';
  } else throw new Error('알 수 없는 행동입니다.');
  next.version++;
  return next;
}
