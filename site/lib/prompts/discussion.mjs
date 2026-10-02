import { NAMES } from '../game.mjs';
import { buildPromptV2 } from './v2.mjs';

// Evaluation candidate only; not wired into the production decision path.
export function buildDiscussionPrompt(input) {
  return buildPromptV2({ ...input, request: { ...input.request,
    ...(input.request.type === 'CHAT' ? { discussionTask: discussionTask(input.request, input.publicState) } : {}) } });
}

// Public facts only: this task must never copy the player's secret knowledge.
export function discussionTask(request, state) {
  const namedTeam = team => (team ?? []).map(id => ({ id, name: NAMES[id] }));
  return {
    goal: request.replyMessage
      ? '질문이나 주장에 직접 답하세요. 어떤 참가자·팀을 왜 의심/지지하는지 특정하고, 그래서 누구를 넣거나 빼고 싶은지 또는 어떤 선택을 지지하는지까지 말하세요.'
      : '지금 결정할 팀에 찬성·반대·교체 제안 중 자신의 입장을 말하세요. 팀이 없으면 구체적인 인원 명단을 제안하세요. 누구를 선택하고 누구를 제외할지와 공개 기록에서 그 이유를 짚으세요.',
    requiredContent: [
      '최소 한 명의 참가자 이름 또는 구체적인 팀 명단',
      '그 참가자·팀의 공개 원정 결과, 공개 투표, 실제 발언 중 관련 근거. 기록이 없으면 검증 목적을 명시',
      '그 근거 때문에 내가 원하는 구체적인 팀 구성·교체·찬반 선택',
    ],
    requirements: [
      '인원수·라운드 안내, 신중하게 하자, 의견을 듣자, 새로운 조합을 보자만으로 발언을 끝내지 마세요.',
      '공개 사실과 자신의 해석을 구분하세요. 첫 원정처럼 근거가 적으면 누구를 넣고 무엇을 확인할지 제안하세요.',
      '실패한 팀에는 악이 적어도 실패 카드 수만큼 있습니다. 성공한 팀도 악이 성공 카드를 냈을 수 있으므로 선으로 확정하지 마세요.',
      '이전 자신의 발언에 새 근거나 구체적인 수정이 없다면 반복하지 말고 SILENCE를 선택할 수 있습니다. 질문받았을 때는 답하세요.',
      '과거 투표 이유를 질문받으면 ownPublicVotes의 선택을 먼저 확인하고, 그 팀의 누구를 우려하는지 또는 지금은 그 선택을 재검토하는지 설명하세요. 당시 판단 이유는 저장되지 않았으므로 당시 마음을 회상하듯 지어내지 마세요. 지금 공개 기록으로 재검토한 설명임을 드러내세요.',
      '자신의 비밀 역할·known·계산 확률은 공개 근거로 말하지 마세요. 타인의 비공개 카드나 아직 공개되지 않은 투표를 안다고 하지 마세요.',
    ],
    currentTeam: namedTeam(state.team),
    questEvidence: (state.quests ?? []).map(q => ({ id: q.id, team: namedTeam(q.team), fails: q.fails, result: q.result })),
    ownPublicVotes: (state.proposals ?? []).flatMap(p => (p.votes ?? [])
      .filter(v => v.actor === request.actor)
      .map(v => ({ proposalId: p.id, quest: p.quest, team: namedTeam(p.team), choice: v.choice }))),
    recentOwnStatements: (state.messages ?? []).filter(m => m.actor === request.actor).slice(-3)
      .map(m => ({ id: m.id, text: m.text })),
  };
}
