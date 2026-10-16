import test from 'node:test';
import assert from 'node:assert/strict';
import { compareLogs } from './compare-routing.mjs';

test('비교 집계는 폐기 비용과 미확인 사용량을 구별하고 선택 차이를 품질 개선으로 쓰지 않는다', () => {
  const record = { mode: 'jev', status: 'OK', inputHash: 'hash', inputTokens: 3000, latencyMs: 120,
    differs: true, applied: true, jevChoice: 'WAIT', outcome: 'PUBLISHED' };
  const report = compareLogs([{ routingAttempts: [record, { ...record, outcome: 'DISCARDED' },
    { ...record, mode: 'shadow', applied: false }, { mode: 'jev', status: 'FALLBACK', inputHash: 'failed', inputTokens: null, latencyMs: 3000 }] }, { events: [] }]);
  assert.equal(report.summary.jevCalls, 4); assert.equal(report.summary.compared, 3);
  assert.equal(report.summary.geminiCallsSkipped, 1); assert.equal(report.summary.discarded, 1);
  assert.equal(report.summary.inputTokens, 9000); assert.equal(report.summary.unknownUsageCalls, 1);
  assert.equal(report.summary.knownCostUsd, 0.000378);
  assert.equal(report.summary.qualityEvaluated, false); assert.equal(report.gamesWithoutRoutingRecords, 1);
  assert.equal(compareLogs([{ events: [{ detail: { routing: { ...record, outcome: 'GENERATION_FAILURE' } } }] }]).summary.geminiCallsSkipped, 0);
});
