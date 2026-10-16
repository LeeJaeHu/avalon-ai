import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeRouting } from '../site/lib/routing-summary.mjs';

export function compareLogs(logs) {
  const attempts = logs.flatMap(log => log.routingAttempts ?? log.events?.flatMap(e => e.detail?.routing ? [{ ...e.detail.routing, outcome: e.detail.routing.outcome ?? 'PUBLISHED' }] : []) ?? []);
  return { format: 'avalon-routing-comparison-v1', games: logs.length,
    gamesWithoutRoutingRecords: logs.filter(log => !log.routingAttempts && !log.events?.some(e => e.detail?.routing)).length,
    summary: summarizeRouting(attempts),
    byMode: Object.fromEntries(['baseline', 'shadow', 'jev'].map(mode => [mode, summarizeRouting(attempts.filter(a => a.mode === mode))])),
    differences: attempts.filter(a => a.status === 'OK' && a.differs).map(a => ({
      gameId: a.gameId, stateVersion: a.stateVersion, messageId: a.messageId,
      baselineActor: a.baselineActor, jevChoice: a.jevChoice, selectedActor: a.selectedActor,
      confidence: a.confidence, inputHash: a.inputHash, outcome: a.outcome,
    })),
    limits: ['선택 불일치는 품질 개선율이 아닙니다.', 'shadow는 기존 대화 궤적에서 같은 상태의 선택을 비교합니다.',
      'JEV 적용 판과 기존 판은 후속 대화가 달라져 승률의 인과 비교가 아닙니다.',
      'knownCostUsd는 사용량이 확인된 JEV 호출만 포함합니다. Gemini·호스팅 비용은 별도입니다.',
      '과거 로그의 미기록 JEV 판단은 복원하지 않습니다. 실제 한국어 모델 품질은 별도 평가가 필요합니다.'],
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv.slice(2).length) { console.error('사용법: node scripts/compare-routing.mjs <종료 로그.json> [추가 로그.json ...]'); process.exitCode = 1; }
  else {
    try { console.log(JSON.stringify(compareLogs(process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')))), null, 2)); }
    catch { console.error('로그 파일을 읽을 수 없습니다. 종료 로그 JSON 경로를 확인해 주세요.'); process.exitCode = 1; }
  }
}
