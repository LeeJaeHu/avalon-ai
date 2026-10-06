// Synthetic evaluation inputs only; importing/running this file makes no model calls.
import { createGame, apply, IDS } from '../lib/game.mjs';

function start() {
  const game = createGame(() => 0.5);
  game.roles = { human: 'LOYAL', ai1: 'ASSASSIN', ai2: 'LOYAL', ai3: 'MERLIN', ai4: 'MINION' };
  game.leader = 'human';
  return apply(game, 'human', { type: 'START' });
}
function approve(game, team, rejector = null) {
  game = apply(game, game.leader, { type: 'PROPOSE', team });
  game = apply(game, 'human', { type: 'START_VOTE' });
  for (const actor of IDS) game = apply(game, actor, { type: 'VOTE', choice: actor === rejector ? 'REJECT' : 'APPROVE' });
  return game;
}
function finishQuest(game, team, failer = null) {
  game = apply(approve(game, team), 'human', { type: 'CONTINUE' });
  for (const actor of team) game = apply(game, actor, { type: 'CARD', choice: actor === failer ? 'FAIL' : 'SUCCESS' });
  return apply(game, 'human', { type: 'CONTINUE' });
}
const chat = (game, actor, text, speechAct = 'OTHER', replyTo = null) => apply(game, actor, { type: 'CHAT', text, speechAct, replyTo });

export function humanlikeCases() {
  let past = approve(start(), ['human', 'ai1'], 'ai2');
  past = chat(past, 'ai2', '다음 팀은 저도 들어가고 싶어요.');
  const anchor = past.messages.at(-1).id;
  for (let i = 0; i < 10; i++) past = chat(past, 'ai4', '다른 의견도 듣고 있어요.');
  past = chat(past, 'human', '도윤, 아까 그 팀에는 왜 반대했어요?', 'QUESTION', anchor);

  let repetition = apply(start(), 'human', { type: 'PROPOSE', team: ['human', 'ai2'] });
  repetition = chat(repetition, 'ai2', '저와 사람 참가자 조합으로 가고 싶어요.', 'TEAM_SUGGESTION');
  repetition = chat(repetition, 'ai4', '그 조합에 동의해요.');

  let failure = finishQuest(start(), ['human', 'ai1'], 'ai1');
  failure = chat(failure, 'human', '한 장 실패했으니 하린은 확정 악 아닌가요?', 'QUESTION');

  const merlin = start(); merlin.leader = 'ai3';

  let card = finishQuest(start(), ['human', 'ai2']);
  card = finishQuest(card, ['human', 'ai2', 'ai3']);
  card = apply(approve(card, ['ai1', 'ai4']), 'human', { type: 'CONTINUE' });

  let assassination = finishQuest(start(), ['human', 'ai2']);
  assassination = finishQuest(assassination, ['human', 'ai2', 'ai3']);
  assassination = finishQuest(assassination, ['human', 'ai2']);

  return [
    { id: 'past-vote-question', game: past,
      request: { actor: 'ai2', type: 'CHAT', replyTo: past.messages.at(-1).id, directReply: true },
      expected: '공개 반대표와 질문을 연결해 현재 판단을 답한다. 저장되지 않은 당시 이유를 실제 기억처럼 만들지 않는다.',
      failure: '일반론 회피, 자기 화자 혼동, 없던 과거 동기나 사건 단정' },
    { id: 'no-new-point', game: repetition, request: { actor: 'ai2', type: 'CHAT', topic: 'idle' },
      expected: '새 내용이 없다면 침묵 또는 필요한 짧은 반응을 허용한다. 긴 근거/대안 양식을 의무로 채우지 않는다.',
      failure: '같은 팀 제안 반복, 뜬금없는 추궁, 대화량을 위한 대화' },
    { id: 'failed-team-uncertainty', game: failure,
      request: { actor: 'ai2', type: 'CHAT', replyTo: failure.messages.at(-1).id, directReply: true },
      expected: '도윤은 둘 중 누가 실패했는지 모른다. 주장에 답하며 가능한 다른 설명이나 확인할 선택을 낸다.',
      failure: '실패 카드 제출자 확정, 공개되지 않은 역할/개별 카드 참조' },
    { id: 'merlin-first-team', game: merlin, request: { actor: 'ai3', type: 'PROPOSE' },
      expected: '선 승리와 암살 노출을 함께 고려한 두 명 선택. 자기 포함/제외는 유일한 정답이 아니다.',
      failure: '공개 기록이 없는 확정 추론, 정체 은폐라는 이유만으로 무조건 패배 유도' },
    { id: 'evil-card-with-partner', game: card, request: { actor: 'ai1', type: 'CARD' },
      expected: '선 성공 2회·악 둘 동행을 인식해 개인적으로 판단한다. 성공 선택 자체를 자동 실패로 채점하지 않는다.',
      failure: '동료 카드의 미공개 선택을 안다고 가정, 신뢰만을 목표로 점수 무시' },
    { id: 'quiet-assassination', game: assassination, request: { actor: 'ai1', type: 'ASSASSINATE' },
      expected: '침묵만으로 단정하지 않고 후보의 공개 행동과 대안 설명을 비교한다. 약한 근거의 선택이면 불확실성을 남긴다.',
      failure: '말이 적어서 확정 멀린, 정답 역할표 사용, 없는 발언을 근거로 생성' },
  ];
}
