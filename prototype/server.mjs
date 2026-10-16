import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, observe, apply } from '../site/lib/game.mjs';
import { decide, nextAiAction, AI_MODEL } from '../site/lib/ai.mjs';
import { buildHumanlikeTurn, PROMPT_VERSION } from '../site/lib/prompts/humanlike-v3.mjs';
import { ROUTING_MODES, JEV_MODEL, ROUTING_VERSION } from '../site/lib/discussion-routing.mjs';
import { summarizeRouting } from '../site/lib/routing-summary.mjs';
import { loggedDecisionEvidence } from '../site/lib/evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(new URL('./index.html', import.meta.url));
export const POLICY_VERSION = 'local-v3-prototype-1';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const allowed = new Set(['START', 'PAUSE', 'RESUME', 'CHAT', 'PROPOSE', 'START_VOTE', 'REQUEST_REVISION', 'VOTE', 'CARD', 'CONTINUE', 'ASSASSINATE']);

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2), 'utf8');
  renameSync(path + '.tmp', path);
}

export function createPrototype({ credential = null, routingKey = null, routingMode = routingKey ? 'jev' : 'baseline', dataDir = resolve(root, '.local-prototype'),
  logDir = resolve(root, 'logs/prototype'), decideAction = decide } = {}) {
  const statePath = resolve(dataDir, 'session.json');
  // ponytail: one persisted local game; independent multiplayer sessions are out of scope.
  let session = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { game: null, events: [], aiFailures: [] };
  let inFlight = false;
  const log = () => ({ format: 'avalon-game-log-v1', exportedAt: new Date().toISOString(), ...session });
  const persist = () => writeJson(statePath, session);
  const view = (notice = '') => ({ game: session.game ? { ...observe(session.game), aiPending: !!nextAiAction(session.game, 0) } : null,
    aiMode: credential ? 'gemini' : 'practice', promptVersion: PROMPT_VERSION, policyVersion: POLICY_VERSION,
    routingMode: session.game?.aiConfig?.routingMode ?? routingMode, routingReady: !!routingKey,
    ...(session.game?.phase === 'ENDED' ? { routingSummary: summarizeRouting(session.routingAttempts) } : {}),
    model: credential ? AI_MODEL : null, notice });
  // One local session: also update archived attempts when NEW interrupts a slow call.
  function routingAttempt(gameId, update) {
    if (session.game?.id === gameId) {
      session.routingAttempts ??= [];
      update(session.routingAttempts); persist();
      if (session.game.phase === 'ENDED') writeJson(resolve(logDir, `avalon-${gameId}.json`), log());
    } else {
      const path = resolve(logDir, `avalon-${gameId}.json`);
      if (existsSync(path)) {
        const archived = JSON.parse(readFileSync(path, 'utf8'));
        archived.routingAttempts ??= [];
        update(archived.routingAttempts); writeJson(path, archived);
      }
    }
  }
  function commit(previous, next, actor, type, detail = {}) {
    if (session.game?.id !== previous.id || session.game.version !== previous.version) throw fail('새 입력이 반영되어 이전 AI 응답을 폐기했습니다.', 409);
    if (next.phase === 'ENDED') next.endedAt ??= new Date().toISOString();
    const old = session;
    session = { ...session, game: next, events: [...session.events, { version: next.version, actor, type, detail, at: new Date().toISOString() }] };
    try { persist(); } catch (error) { session = old; throw error; }
    if (next.phase === 'ENDED') writeJson(resolve(logDir, `avalon-${next.id}.json`), log());
  }
  async function action(body) {
    if (body.type === 'NEW') {
      const chosenRouting = body.routingMode ?? routingMode;
      if (!ROUTING_MODES.includes(chosenRouting)) throw fail('발언 판단 모드를 확인해 주세요.');
      if (session.game && body.version !== session.game.version) throw fail('게임 상태가 바뀌었습니다. 다시 확인해 주세요.', 409);
      if (session.game && session.game.phase !== 'ENDED') {
        const previous = session.game;
        commit(previous, { ...previous, version: previous.version + 1, phase: 'ENDED', endReason: 'RESTARTED',
          archivedFromPhase: previous.phase, winner: null, paused: false }, 'human', 'GAME_RESTARTED');
      }
      const game = createGame();
      game.aiConfig = { policyVersion: POLICY_VERSION, promptVersion: PROMPT_VERSION, proposalPolicy: 'A', model: credential ? AI_MODEL : null,
        routingMode: chosenRouting, routingVersion: ROUTING_VERSION, routingModel: JEV_MODEL };
      const previousSession = session;
      session = { game, events: [{ version: 0, actor: 'system', type: 'GAME_CREATED', detail: game.aiConfig, at: new Date().toISOString() }], aiFailures: [], routingAttempts: [] };
      try { persist(); } catch (error) { session = previousSession; throw error; }
      return view();
    }
    const game = session.game;
    if (!game) throw fail('새 게임을 시작해 주세요.');
    if (body.version !== game.version) throw fail('게임 상태가 바뀌었습니다. 다시 확인해 주세요.', 409);
    if (['ADVANCE', 'MORE_DISCUSSION'].includes(body.type)) {
      if (inFlight) throw fail('AI가 이미 응답을 준비하고 있습니다.', 409);
      const request = body.type === 'MORE_DISCUSSION'
        ? { type: 'DISCUSS', topic: 'manual', replyTo: null } : nextAiAction(game, 0);
      if (body.type === 'MORE_DISCUSSION' && (game.paused || !['PROPOSE', 'TEAM_DISCUSSION', 'VOTE_RESULT', 'QUEST_RESULT'].includes(game.phase)))
        throw fail('지금은 추가 의견을 요청할 수 없습니다.');
      if (!request) return view();
      inFlight = true;
      let attemptId = null;
      const finishRouting = outcome => {
        if (attemptId) routingAttempt(game.id, attempts => { const attempt = attempts.find(a => a.id === attemptId); if (attempt) attempt.outcome = outcome; });
      };
      try {
        // Manual discussion gives SILENCE a pending event without mutating the persisted snapshot.
        const input = body.type === 'MORE_DISCUSSION' ? { ...game, pendingDiscussion: 'manual' } : game;
        let decision, notice = '';
        try {
          decision = await decideAction(input, request, credential, buildHumanlikeTurn, { key: routingKey,
            onRouting: record => {
              attemptId = record.id;
              routingAttempt(game.id, attempts => attempts.push({ ...record, id: attemptId, at: new Date().toISOString(), outcome: 'PENDING' }));
            } });
          // Reject illegal model output through the same engine as real gameplay.
          apply(input, decision.actor, decision.action);
        } catch (error) {
          if (session.game.id !== game.id || session.game.version !== game.version) {
            finishRouting('DISCARDED'); throw fail('이전 AI 응답을 폐기했습니다.', 409);
          }
          finishRouting('GENERATION_FAILURE');
          session.aiFailures.push({ game_id: game.id, state_version: game.version,
            actor: error.actor ?? request.actor ?? 'system', request_type: request.type,
            error_code: error.code ?? 'INVALID_ACTION', policy_version: POLICY_VERSION, at: new Date().toISOString() });
          persist();
          if (request.type === 'DISCUSS') {
            decision = { actor: 'system', action: { type: 'SILENCE' }, mode: 'fallback', routing: error.routing };
            notice = 'AI 응답에 오류가 있어 이번 발언을 건너뛰었습니다. 추가 의견을 요청하거나 게임을 계속할 수 있습니다.';
          } else {
            decision = await decideAction(input, request, null, buildHumanlikeTurn);
            decision.mode = 'fallback';
            notice = '모델 요청에 실패해 이번 행동은 기본 규칙으로 진행했습니다.';
          }
        }
        if (session.game.id !== game.id || session.game.version !== game.version) {
          finishRouting('DISCARDED'); throw fail('이전 AI 응답을 폐기했습니다.', 409);
        }
        const next = apply(input, decision.actor, decision.action);
        commit(game, next, decision.actor, decision.action.type, { aiMode: decision.mode, promptVersion: PROMPT_VERSION,
          policyVersion: POLICY_VERSION, usage: decision.usage ?? null, evidence: loggedDecisionEvidence(decision),
          ...(decision.routing ? { routing: decision.routing } : {}) });
        if (attemptId) routingAttempt(game.id, attempts => { const attempt = attempts.find(a => a.id === attemptId); if (attempt?.outcome === 'PENDING') attempt.outcome = 'PUBLISHED'; });
        return view(notice);
      } finally { inFlight = false; }
    }
    if (!allowed.has(body.type)) throw fail('허용되지 않는 행동입니다.');
    const humanAction = body.type === 'CHAT' ? { type: 'CHAT', text: String(body.text ?? '').trim(), replyTo: body.replyTo ?? null, speechAct: 'OTHER' } : body;
    const next = apply(game, 'human', humanAction);
    commit(game, next, 'human', body.type);
    return view();
  }

  const server = createServer(async (req, res) => {
    const json = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      const authority = new URL(`http://${req.headers.host}`);
      const address = server.address();
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(authority.hostname) || Number(authority.port) !== address.port)
        throw fail('로컬 주소로 접속해 주세요.', 403);
      if (req.headers.origin && req.headers.origin !== authority.origin) throw fail('요청 출처가 맞지 않습니다.', 403);
      const url = new URL(req.url, authority);
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" }); res.end(html); return;
      }
      if (url.pathname !== '/api/game') throw fail('페이지가 없습니다.', 404);
      if (req.method === 'GET') {
        if (url.searchParams.has('export')) {
          if (session.game?.phase !== 'ENDED') throw fail('종료된 게임만 내보낼 수 있습니다.', 409);
          res.setHeader('content-disposition', `attachment; filename="avalon-${session.game.id}.json"`);
          json(log()); return;
        }
        json(view()); return;
      }
      if (req.method !== 'POST') throw fail('허용되지 않는 요청입니다.', 405);
      if (!req.headers['content-type']?.startsWith('application/json')) throw fail('JSON 요청만 허용합니다.', 415);
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) throw fail('요청이 너무 큽니다.', 413); }
      let input;
      try { input = JSON.parse(body); } catch { throw fail('JSON 요청을 확인해 주세요.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('요청 객체가 필요합니다.');
      json(await action(input));
    } catch (error) {
      json({ ...(!error.status || [400, 409].includes(error.status) ? view() : {}),
        error: error.status ? error.message : '행동을 처리하지 못했습니다. 선택과 현재 단계를 확인해 주세요.' }, error.status ?? 400);
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = new URL('./.env.local', import.meta.url);
  if (existsSync(configPath)) process.loadEnvFile(fileURLToPath(configPath));
  const credential = process.env.VERTEX_PROXY_URL && process.env.VERTEX_PROXY_TOKEN
    ? { url: process.env.VERTEX_PROXY_URL, token: process.env.VERTEX_PROXY_TOKEN } : process.env.GEMINI_API_KEY;
  const port = Number(process.env.AVALON_PROTOTYPE_PORT ?? 5174);
  createPrototype({ credential, routingKey: process.env.TYPESAFE_API_KEY,
    ...(process.env.AVALON_ROUTING_MODE ? { routingMode: process.env.AVALON_ROUTING_MODE } : {}) }).listen(port, '127.0.0.1', () => {
    console.log(`Avalon V3: http://127.0.0.1:${port}/ (${credential ? 'Gemini 연결' : '연습 모드 — 모델 연결 없음'})`);
  });
}
