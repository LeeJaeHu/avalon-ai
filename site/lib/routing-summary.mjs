export function summarizeRouting(attempts = []) {
  const compared = attempts.filter(a => a.status === 'OK');
  const called = attempts.filter(a => a.inputHash);
  const measured = called.filter(a => Number.isSafeInteger(a.inputTokens));
  const latencies = called.map(a => a.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = p => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] : null;
  const inputTokens = measured.reduce((total, a) => total + a.inputTokens, 0);
  return {
    attempts: attempts.length, jevCalls: called.length, compared: compared.length,
    differentChoices: compared.filter(a => a.differs).length,
    agreementRate: compared.length ? compared.filter(a => !a.differs).length / compared.length : null,
    waitChoices: compared.filter(a => a.jevChoice === 'WAIT').length,
    geminiCallsSkipped: compared.filter(a => a.applied && a.jevChoice === 'WAIT' && a.outcome === 'PUBLISHED').length,
    fallbacks: attempts.filter(a => ['NO_KEY', 'FALLBACK', 'PRACTICE_NO_MODEL'].includes(a.status)).length,
    discarded: attempts.filter(a => a.outcome === 'DISCARDED').length,
    generationFailures: attempts.filter(a => a.outcome === 'GENERATION_FAILURE').length,
    unknownUsageCalls: called.length - measured.length, inputTokens,
    knownCostUsd: inputTokens * 0.042 / 1_000_000,
    latencyP50Ms: percentile(0.5), latencyP95Ms: percentile(0.95),
    modes: Object.fromEntries(['baseline', 'shadow', 'jev'].map(mode => [mode, attempts.filter(a => a.mode === mode).length])),
    qualityEvaluated: false,
  };
}
