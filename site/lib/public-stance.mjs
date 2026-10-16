export const PUBLIC_STANCE_GUIDANCE = '공개 발언과 행동을 연결하세요. boundaryStatus=UNAVAILABLE이면 제안 전후 구분이 불가능하므로 빈 목록을 발언 부재로 단정하지 마세요. publicStance의 currentTeamStatements는 현재 팀 제안 이후 본인이 실제로 공개한 말이며 previousStatements는 이전 입장입니다. eventAssessment의 speechPlan과 previousThinking은 아직 말하지 않은 계획일 수 있고 타인의 질문은 본인의 발언이 아닙니다. 공개 근거와 비밀 지식을 구분하세요. 팀 교체·미해결 질문에 구체적인 우려가 있거나 공개 흐름과 다른 투표/팀을 생각한다면 발언 기회에 질문·우려·대안·입장 변경 조건을 먼저 짧게 표현하세요. 설명을 듣고 판단을 바꿀 수 있습니다. 비밀 지식을 숨기려고 공개 사실을 꾸미거나 악을 확정 지목하지 마세요. 멀린/악은 공개 근거와 사전 입장이 부족한 행동의 정체 노출 위험을 덜 노출되는 합법 대안과 비교하세요. 멀린은 2승0패처럼 실패를 감수할 여유와 암살 회피를 함께 고려하되, 2패나 5번째 부결처럼 즉시 패배할 위험이 크면 필요한 반대를 억제하지 마세요. 발언 부재만으로 찬성하거나 다른 사람을 무조건 따라가는 규칙은 아닙니다. 미공개 타인의 표는 알 수 없으며 공개 발언/과거 공개 투표만 비교하세요.';

export function newGameEndgameExposure(value) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error('막판 정체 노출 허용 설정을 확인해 주세요.');
  return value;
}

export function publicStanceGuidance(config) {
  return `${PUBLIC_STANCE_GUIDANCE}\n${config?.endgameExposureAllowed !== false
    ? '막판 정체 노출 허용: ON. 원정 실패/5회 부결로 즉시 패배할 수 있는 막판에는 승리를 위해 노출 위험을 감수하는 선택을 허용합니다. 항상 공격적으로 행동하라는 뜻은 아닙니다. 멀린은 암살 위험도 남아 있음을 고려하세요.'
    : '막판 정체 노출 허용: OFF. 역할 맞추기 전 막판에도 정체 은폐와 실제 공개 입장의 일관성을 유지하는 대안을 비교하세요. 마지막이라며 뒤없이 행동하거나 즉시 패배 위험만으로 노출을 무시하지 마세요. 필요한 반대나 승리 시도를 금지하지는 않으며 공개 근거로 설득하거나 덜 노출되는 합법 대안을 찾으세요. 일부러 패배하거나 무조건 찬성/침묵하지 마세요.'}`;
}

export function publicStance(game, actor) {
  const event = game.publicEvents.findLast(e => e.kind === 'TEAM');
  const statements = game.messages.map((m, index) => ({ ...m, index })).filter(m => m.actor === actor);
  const known = Number.isSafeInteger(event?.messageCount) && event.messageCount >= 0 && event.messageCount <= game.messages.length;
  const after = m => m.index >= event.messageCount;
  const pick = m => ({ id: m.id, text: m.text });
  return { currentTeamEventId: event?.id ?? null,
    boundaryStatus: known ? 'KNOWN' : 'UNAVAILABLE',
    currentTeamStatements: known ? statements.filter(after).slice(-4).map(pick) : [],
    previousStatements: known ? statements.filter(m => !after(m)).slice(-4).map(pick) : [],
    unclassifiedStatements: known ? [] : statements.slice(-4).map(pick) };
}

export const SPEECH_OWNERSHIP_GUIDANCE = '말하기 전에 본인이 할 구체적인 한 문장을 구상하고, 누구의 행동/발언을 설명하는지와 기존 대화에 더하는 새 정보를 확인하세요. speechContext의 proposalAuthor와 speaker가 다르면 남의 팀 선정 의도를 본인 의도처럼 해명하지 마세요. rejectedBy와 ownPublishedVote를 확인하고 남의 반대표를 본인의 선택처럼 설명하지 마세요. 인용된 말의 원저자와 바로 앞 발언자를 구분하세요. 타인의 속마음은 알 수 없으므로 공개 발언을 인용하거나 본인의 해석임을 명시하세요. 자신의 실제 선택 이유, 직접 받은 질문의 답, 공개 사실에 근거한 새 질문/반론/대안 중 구체적인 기여가 있을 때만 말하세요. 같은 취지의 재진술·동의·남의 해명 대신하기만 가능하면 WAIT/SILENCE를 선택하세요. 단순히 팀원이라는 이유나 누군가 반대했다는 이유만으로 본인이 해명할 필요는 없습니다. 직접 질문에는 답하되 다른 사람을 대신 설명하지 마세요.';

export function speechContext(game, actor, request) {
  const proposal = game.proposals.at(-1);
  const published = ['APPROVED', 'REJECTED'].includes(proposal?.status);
  const focus = game.messages.find(m => m.id === request.replyTo);
  const quoted = game.messages.find(m => m.id === focus?.replyTo);
  return { speaker: actor, proposalId: proposal?.id ?? null, proposalAuthor: proposal?.leader ?? null,
    isProposalAuthor: proposal?.leader === actor,
    ownPublishedVote: published ? proposal.votes?.find(v => v.actor === actor)?.choice ?? null : null,
    rejectedBy: published ? (proposal.votes ?? []).filter(v => v.choice === 'REJECT').map(v => v.actor) : [],
    focus: focus ? { id: focus.id, actor: focus.actor, text: focus.text } : null,
    quoted: quoted ? { id: quoted.id, actor: quoted.actor, text: quoted.text } : null };
}
