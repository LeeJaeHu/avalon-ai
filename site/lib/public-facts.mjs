import { IDS, NAMES } from './game.mjs';

// 공개 기록(팀·투표·원정 결과)에서 서버가 계산하는 확정 사실. 모델이 직접 세다가 틀리는 부분을 대신 계산한다.
export const PUBLIC_FACTS_VERSION = 'public-facts-v1';
export const PUBLIC_FACTS_GUIDANCE = 'publicFacts.public은 서버가 공개 기록에서 계산한 확정 사실입니다. 팀 구성·실패 이력·투표를 말하거나 판단할 때 이와 다르게 말하지 마세요. 예를 들어 identicalToFailedQuests가 있는 팀을 "다른 조합"이라고 설명하지 마세요. publicFacts.self는 본인에게 허용된 정보로 계산한 관점이며 공개 발언에서 그 근거(역할·비공개 지식)를 밝히지 마세요. exposedTo는 공개 기록만으로 본인을 확정 악으로 아는 사람, cardIfFail.newlyCertainTo는 이번에 실패를 내면 새로 확정 악으로 알게 되는 사람입니다. voteSignals의 unexplainedCorrectRejects는 공개 근거 없이 악이 포함된 팀에 반대한 횟수로 멀린처럼 보이는 신호입니다.';

const EVIL = new Set(['ASSASSIN', 'MINION']);
const sameMembers = (a, b) => a.length === b.length && a.every(id => b.includes(id));
const combinations = (items, size) => size === 0 ? [[]] : items.flatMap((item, i) =>
  combinations(items.slice(i + 1), size - 1).map(rest => [item, ...rest]));
const evilCount = roleCounts => Object.entries(roleCounts ?? {}).reduce((sum, [role, n]) => sum + (EVIL.has(role) ? n : 0), 0) || 2;

// observer가 선이라고 가정할 때, 공개 원정 결과와 모순되지 않는 악 조합들.
function evilSets(observer, quests, size) {
  return combinations(IDS.filter(id => id !== observer), size)
    .filter(set => quests.every(q => q.team.filter(id => set.includes(id)).length >= q.fails));
}
const certainIn = sets => sets.length ? IDS.filter(id => sets.every(set => set.includes(id))) : [];

const normalize = quests => quests.map((q, i) => ({ id: q.id ?? `quest-${i + 1}`, proposalId: q.proposalId, team: q.team, fails: q.fails, result: q.result }));

function teamFacts(team, quests) {
  const failed = quests.filter(q => q.result === 'FAIL');
  return {
    team,
    identicalToFailedQuests: failed.filter(q => sameMembers(q.team, team)).map(q => q.id),
    identicalToSuccessfulQuests: quests.filter(q => q.result === 'SUCCESS' && sameMembers(q.team, team)).map(q => q.id),
    membersFromFailedQuests: team.map(id => ({ id, failedQuests: failed.filter(q => q.team.includes(id)).map(q => q.id) }))
      .filter(x => x.failedQuests.length),
  };
}

export function teamNote(team, quests) {
  const f = teamFacts(team, normalize(quests));
  const notes = [];
  if (f.identicalToFailedQuests.length) notes.push(`${f.identicalToFailedQuests.map(id => id.replace('quest-', '')).join('·')}원정 실패팀과 동일`);
  else if (f.membersFromFailedQuests.length) notes.push(`실패 원정 참가자 ${f.membersFromFailedQuests.map(x => NAMES[x.id]).join('·')} 포함`);
  if (f.identicalToSuccessfulQuests.length) notes.push(`${f.identicalToSuccessfulQuests.map(id => id.replace('quest-', '')).join('·')}원정 성공팀과 동일`);
  return notes.length ? ` [${notes.join(', ')}]` : '';
}

function publicVoteSignals(proposals, quests) {
  const signals = Object.fromEntries(IDS.map(id => [id, { rejectedLaterFailed: 0, unexplainedCorrectRejects: 0, approvedLaterFailed: 0 }]));
  for (const p of proposals) {
    const quest = quests.find(q => q.proposalId === p.id);
    if (p.status !== 'APPROVED' || !quest) continue;
    const priorFailedMembers = new Set(quests.slice(0, quests.indexOf(quest)).filter(q => q.result === 'FAIL').flatMap(q => q.team));
    const explained = p.team.some(id => priorFailedMembers.has(id));
    for (const v of p.votes ?? []) {
      if (quest.result !== 'FAIL') continue;
      if (v.choice === 'REJECT') { signals[v.actor].rejectedLaterFailed++; if (!explained) signals[v.actor].unexplainedCorrectRejects++; }
      else signals[v.actor].approvedLaterFailed++;
    }
  }
  return signals;
}

// 악과 멀린은 실제 악을 알므로, 각자의 표가 실제 악 포함 여부와 얼마나 맞는지 계산할 수 있다.
function trueEvilVoteMatch(proposals, quests, evilIds, voter) {
  const out = { matches: 0, mismatches: 0, unexplainedRejectMatches: 0 };
  for (const p of proposals) {
    if (!['APPROVED', 'REJECTED'].includes(p.status)) continue;
    const vote = p.votes?.find(v => v.actor === voter);
    if (!vote) continue;
    const hasEvil = p.team.some(id => evilIds.includes(id));
    const match = hasEvil ? vote.choice === 'REJECT' : vote.choice === 'APPROVE';
    if (match) out.matches++; else out.mismatches++;
    const idx = quests.findIndex(q => q.proposalId === p.id);
    const prior = idx === -1 ? quests : quests.slice(0, idx);
    const priorFailedMembers = new Set(prior.filter(q => q.result === 'FAIL').flatMap(q => q.team));
    if (match && hasEvil && !p.team.some(id => priorFailedMembers.has(id))) out.unexplainedRejectMatches++;
  }
  return out;
}

export function publicFacts(view, actor) {
  const quests = normalize(view.quests);
  const proposals = view.proposals;
  const size = evilCount(view.roleCounts);
  const publicPart = {
    version: PUBLIC_FACTS_VERSION,
    score: { successes: quests.filter(q => q.result === 'SUCCESS').length, failures: quests.filter(q => q.result === 'FAIL').length },
    playerRecords: Object.fromEntries(IDS.map(id => [id, {
      failedQuests: quests.filter(q => q.result === 'FAIL' && q.team.includes(id)).map(q => q.id),
      successfulQuests: quests.filter(q => q.result === 'SUCCESS' && q.team.includes(id)).map(q => q.id) }])),
    currentTeam: view.team?.length ? teamFacts(view.team, quests) : null,
    voteSignals: publicVoteSignals(proposals, quests),
  };
  const self = { role: view.role };
  if (view.role === 'LOYAL') {
    const sets = evilSets(actor, quests, size);
    self.certainEvil = certainIn(sets);
    self.certainGood = IDS.filter(id => id !== actor && sets.length && sets.every(set => !set.includes(id)));
  }
  if (EVIL.has(view.role)) {
    const allies = view.known;
    const certainTo = qs => IDS.filter(id => id !== actor && !allies.includes(id) && certainIn(evilSets(id, qs, size)).includes(actor));
    self.exposedTo = certainTo(quests);
    if (view.phase === 'QUEST' && view.team?.includes(actor)) {
      const hypothetical = [...quests, { id: 'hypothetical', team: view.team, fails: 1, result: 'FAIL' }];
      self.cardIfFail = { newlyCertainTo: certainTo(hypothetical).filter(id => !self.exposedTo.includes(id)),
        allyOnTeam: allies.filter(id => view.team.includes(id)) };
    }
    if (view.role === 'ASSASSIN') self.merlinVoteSignals = Object.fromEntries(IDS.filter(id => id !== actor && !allies.includes(id))
      .map(id => [id, trueEvilVoteMatch(proposals, quests, [actor, ...allies], id)]));
  }
  if (view.role === 'MERLIN') self.ownMerlinSignal = trueEvilVoteMatch(proposals, quests, view.known, actor);
  return { public: publicPart, self };
}
