import {gameUsage} from './usage.mjs';
export async function gameLog(db, game) {
  const [events, failures] = await Promise.all([
    db.prepare('SELECT version, actor, type, detail, at FROM events WHERE game_id = ? ORDER BY version').bind(game.id).all(),
    db.prepare('SELECT state_version, actor, request_type, stage, error_code, policy_version, model, latency_ms, at FROM ai_failures WHERE game_id = ? ORDER BY at').bind(game.id).all(),
  ]);
  const usage=await gameUsage(db,game);
  return { format: 'avalon-game-log-v1', exportedAt: new Date().toISOString(), game,roleGuess:game.roleGuess??null,modelUsage:usage.records,usageSummary:usage.summary,
    events: events.results.map(row => ({ ...row, detail: JSON.parse(row.detail) })), aiFailures: failures.results };
}

export async function validLogToken(provided, expected) {
  if (!expected || !provided) return false;
  const encoder = new TextEncoder();
  const digests = await Promise.all([provided, expected].map(token => crypto.subtle.digest('SHA-256', encoder.encode(token))));
  const [left, right] = digests.map(value => new Uint8Array(value));
  return left.reduce((diff, value, index) => diff | (value ^ right[index]), 0) === 0;
}
