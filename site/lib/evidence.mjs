export function evidenceReferenceIds(state, personal = {}) {
  return [...new Set([
    ...(state.proposals ?? []).map(p => p.id),
    ...(state.quests ?? []).map(q => q.id),
    ...(state.messages ?? []).map(m => m.id),
    ...(state.earlierResponses ?? []).map(m => m.id),
    ...(state.publicEvents ?? []).map(e => e.id),
    'self-role',
    ...(personal.known?.length ? ['known-players'] : []),
    ...(personal.ownVote ? ['own-vote'] : []),
    ...(personal.ownCards?.length ? ['own-cards'] : []),
  ])];
}

export function normalizeEvidence(value, allowedIds) {
  if (value == null) return { status: 'MISSING' };
  if (typeof value !== 'object' || Array.isArray(value)
    || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.trim().length > 240
    || !['LOW','MEDIUM','HIGH'].includes(value.confidence)
    || !Array.isArray(value.references) || value.references.length > 4
    || value.references.some(id => typeof id !== 'string' || !allowedIds.includes(id)))
    return { status: 'INVALID' };
  return { status: 'RECORDED', summary: value.summary.trim(), references: [...new Set(value.references)], confidence: value.confidence };
}

export function loggedDecisionEvidence(decision) {
  if (decision.mode === 'gemini') return decision.evidence ?? { status: 'MISSING' };
  if (decision.mode === 'jev') return { status: 'STRUCTURED_DECISION', source: 'jev', selected: decision.selection.selected, confidence: decision.selection.confidence, probabilities: decision.selection.probabilities };
  return { status: 'NOT_MODEL', source: decision.mode,
    ...(decision.action.type === 'ASSASSINATE' ? { summary: '기본 규칙에 따라 본인과 알려진 동료 악을 제외한 첫 후보를 선택했습니다. 멀린을 추론한 모델 선택이 아닙니다.' } : {}) };
}
