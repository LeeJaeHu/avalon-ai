import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { createGame, observe, apply } from '../../../lib/game.mjs';
import { AI_MODEL, AI_POLICY_VERSION, PROMPT_VERSION, decide, idleDueAt, nextAiAction } from '../../../lib/ai.mjs';
import { gameLog } from '../../../lib/game-log.mjs';

export const runtime = 'edge';
const cookie = 'avalon_game';
const modelCredential = () => env.VERTEX_PROXY_URL && env.VERTEX_PROXY_TOKEN
  ? { url: env.VERTEX_PROXY_URL, token: env.VERTEX_PROXY_TOKEN }
  : env.GEMINI_API_KEY;
const aiMode = () => modelCredential() ? 'gemini' : 'practice';

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

function view(game: any) {
  const playerView = observe(game);
  return { ...playerView, aiPending: !!nextAiAction(game), idleDueAt: idleDueAt(game) };
}

async function readGame(request: NextRequest) {
  const id = request.cookies.get(cookie)?.value;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = await env.DB!.prepare('SELECT state FROM games WHERE id = ?').bind(id).first<{ state: string }>();
  return row ? JSON.parse(row.state) : null;
}

async function save(previous: any, next: any, actor: string, type: string, detail: object = {}) {
  const at = new Date().toISOString();
  if (next.phase === 'ENDED' && previous.phase !== 'ENDED') next.endedAt = at;
  const updated = env.DB!.prepare('UPDATE games SET state = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')
    .bind(JSON.stringify(next), next.version, at, next.id, previous.version);
  const event = env.DB!.prepare('INSERT INTO events (game_id, version, actor, type, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(next.id, next.version, actor, type, JSON.stringify(detail), at);
  let results;
  try { results = await env.DB!.batch([updated, event]); }
  catch (error) {
    const current = await env.DB!.prepare('SELECT version FROM games WHERE id = ?').bind(previous.id).first<{ version: number }>();
    if (current && current.version !== previous.version) throw Object.assign(new Error('상태가 변경됐습니다.'), { code: 'STALE_STATE' });
    throw error;
  }
  if (!results[0].meta.changes) throw Object.assign(new Error('상태가 변경됐습니다.'), { code: 'STALE_STATE' });
}

async function recordModelFailure(game: any, actor: string, requestType: string, stage: string, error: unknown, started: number) {
  const code = stage === 'validation'
    ? ((error as Error).message === '팀 인원이 맞지 않습니다.' ? 'INVALID_TEAM' : 'INVALID_ACTION')
    : (error as { code?: string })?.code ?? 'MODEL_ERROR';
  try {
    await env.DB!.prepare('INSERT INTO ai_failures (game_id, state_version, actor, request_type, stage, error_code, policy_version, model, latency_ms, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(game.id, game.version, (error as any)?.actor ?? actor, requestType, stage, code,
        AI_POLICY_VERSION, AI_MODEL, Date.now() - started, new Date().toISOString()).run();
  } catch (logError) {
    console.error(JSON.stringify({ event: 'ai_failure_record_failure', message: String(logError) }));
  }
}

export async function GET(request: NextRequest) {
  try {
    const game = await readGame(request);
    if (new URL(request.url).searchParams.has('diagnostics')) {
      if (!game) return json({ error: '게임이 없습니다.' }, 404);
      const [eventRows, failureRows] = await Promise.all([
        env.DB!.prepare('SELECT version, actor, type, at FROM events WHERE game_id = ? ORDER BY version').bind(game.id).all(),
        env.DB!.prepare('SELECT state_version, actor, request_type, stage, error_code, policy_version, model, latency_ms, at FROM ai_failures WHERE game_id = ? ORDER BY at').bind(game.id).all(),
      ]);
      const diagnostic = { format: 'avalon-diagnostics-v1', exportedAt: new Date().toISOString(),
        gameId: game.id, version: game.version, phase: game.phase, quest: game.quest + 1, attempt: game.attempt,
        aiConfig: game.aiConfig ? { policyVersion: game.aiConfig.policyVersion, promptVersion: game.aiConfig.promptVersion, model: game.aiConfig.model,
          ...(game.phase === 'ENDED' ? { proposalPolicy: game.aiConfig.proposalPolicy } : {}) } : null,
        events: eventRows.results, aiFailures: failureRows.results };
      return new Response(JSON.stringify(diagnostic, null, 2), { headers: {
        'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="avalon-diagnostics-${game.id}.json"`,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      } });
    }
    if (new URL(request.url).searchParams.has('export')) {
      if (!game) return json({ error: '게임이 없습니다.' }, 404);
      if (game.phase !== 'ENDED') return json({ error: '종료된 게임만 내려받을 수 있습니다.' }, 409);
      const log = await gameLog(env.DB!, game);
      return new Response(JSON.stringify(log, null, 2), { headers: {
        'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="avalon-${game.id}.json"`,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      } });
    }
    return json({ game: game ? view(game) : null, aiMode: aiMode() });
  } catch (error) {
    console.error(JSON.stringify({ event: 'game_read_failure', message: String(error) }));
    return json({ error: '게임을 불러오지 못했습니다.' }, 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: '요청 출처가 맞지 않습니다.' }, 403);
    const body: any = await request.json();
    if (body.type === 'NEW') {
      const previous = await readGame(request);
      if (previous && previous.phase !== 'ENDED') {
        if (body.version !== previous.version) return json({ error: '상태가 변경됐습니다. 다시 확인하세요.', game: view(previous) }, 409);
        const archived = { ...previous, version: previous.version + 1, phase: 'ENDED', winner: null,
          endReason: 'RESTARTED', archivedFromPhase: previous.phase, paused: false };
        await save(previous, archived, 'human', 'GAME_RESTARTED');
      }
      const game = { ...createGame(), aiConfig: { policyVersion: AI_POLICY_VERSION, promptVersion: PROMPT_VERSION,
        proposalPolicy: Math.random() < 0.5 ? 'A' : 'B',
        model: modelCredential() ? AI_MODEL : null } };
      const at = new Date().toISOString();
      await env.DB!.prepare('INSERT INTO games (id, version, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(game.id, game.version, JSON.stringify(game), at, at).run();
      await env.DB!.prepare('INSERT INTO events (game_id, version, actor, type, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(game.id, 0, 'system', 'GAME_CREATED', JSON.stringify(game.aiConfig), at).run();
      const response = json({ game: view(game), aiMode: aiMode() });
      response.cookies.set(cookie, game.id, { httpOnly: true, secure: new URL(request.url).protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
      return response;
    }
    const game = await readGame(request);
    if (!game) return json({ error: '게임이 없습니다. 새 게임을 시작하세요.' }, 404);
    if (body.version !== game.version) return json({ error: '상태가 변경됐습니다. 다시 확인하세요.', game: view(game) }, 409);
    if (body.type === 'ADVANCE') {
      const requestAction = nextAiAction(game);
      if (!requestAction) return json({ game: view(game), aiMode: aiMode() });
      const started = Date.now();
      let stage = 'model';
      try {
        let decision = await decide(game, requestAction, modelCredential());
        let next;
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = await readGame(request);
          if (current && current.version !== game.version) return json({ game: view(current), aiMode: aiMode() });
          stage = 'validation';
          try { next = apply(game, decision.actor, decision.action); break; }
          catch (error) {
            if (requestAction.type !== 'PROPOSE' || (error as Error).message !== '팀 인원이 맞지 않습니다.' || !modelCredential() || attempt === 2) throw error;
            await recordModelFailure(game, requestAction.actor, requestAction.type, stage, error, started);
            stage = 'model';
            if (attempt === 0) {
              try { decision = await decide(game, { ...requestAction, retryReason: 'INVALID_TEAM' }, modelCredential()); }
              catch (retryError) {
                await recordModelFailure(game, requestAction.actor, requestAction.type, 'model', retryError, started);
                decision = { ...await decide(game, requestAction, null), mode: 'fallback' };
              }
            } else decision = { ...await decide(game, requestAction, null), mode: 'fallback' };
          }
        }
        const { actor, action, usage, mode, plan } = decision;
        stage = 'save';
        await save(game, next, actor, action.type, { aiMode: mode, policyVersion: AI_POLICY_VERSION, promptVersion: PROMPT_VERSION,
          proposalPolicy: game.aiConfig?.proposalPolicy ?? 'A', ...(plan ? { plan } : {}),
          model: mode === 'gemini' ? AI_MODEL : null, speechAct: action.type === 'CHAT' && 'speechAct' in action ? action.speechAct : null,
          inputTokens: usage?.input ?? null,
          outputTokens: usage?.output ?? null, latencyMs: usage?.latencyMs ?? null, modelRetries: usage && 'retries' in usage ? usage.retries : 0 });
        return json({ game: view(next), aiMode: aiMode(), ...(mode === 'fallback' ? { notice: 'AI가 유효한 팀을 제안하지 못해 기본 전략으로 팀을 구성했습니다.' } : {}) });
      } catch (error) {
        if ((error as { code?: string })?.code === 'STALE_STATE') {
          const current = await readGame(request);
          if (current) return json({ game: view(current), aiMode: aiMode() });
        }
        if (stage !== 'save' && modelCredential())
          await recordModelFailure(game, requestAction.actor ?? 'system', requestAction.type, stage, error, started);
        if (requestAction.type === 'DISCUSS' && stage !== 'save') {
          const next = apply(game, 'system', { type: 'SILENCE', ...(requestAction.idleTrigger ? { idleTrigger: true } : {}) });
          await save(game, next, 'system', 'SILENCE', { reason: 'MODEL_FAILURE', errorCode: (error as { code?: string })?.code ?? 'INVALID_ACTION', policyVersion: AI_POLICY_VERSION,
            actor: (error as any)?.actor ?? null, expectedType: (error as any)?.expectedType ?? null, returnedType: (error as any)?.returnedType ?? null,
            finishReason: (error as any)?.finishReason ?? null, responseChars: (error as any)?.responseChars ?? null, outputTokens: (error as any)?.outputTokens ?? null });
          return json({ game: view(next), aiMode: aiMode(), notice: 'AI 발언에 오류가 있어 이번 발언을 건너뛰었습니다. 게임은 계속 진행됩니다.' });
        }
        if (stage !== 'save' && requestAction.actor && ['PROPOSE', 'VOTE', 'CARD', 'ASSASSINATE'].includes(requestAction.type)) {
          // Recheck after the failed call: never overwrite a pause, chat, or newer action.
          const current = await readGame(request);
          if (current && current.version !== game.version) return json({ game: view(current), aiMode: aiMode() });
          const fallback = await decide(game, requestAction, null);
          const next = apply(game, fallback.actor, fallback.action);
          await save(game, next, fallback.actor, fallback.action.type, { aiMode: 'fallback', reason: 'MODEL_FAILURE',
            errorCode: (error as { code?: string })?.code ?? 'INVALID_ACTION', policyVersion: AI_POLICY_VERSION, promptVersion: PROMPT_VERSION });
          return json({ game: view(next), aiMode: aiMode(), notice: 'AI 요청에 실패해 이번 행동은 기본 규칙으로 처리했습니다. 기록에 오류와 대체 처리를 남겼습니다.' });
        }
        throw error;
      }
    }
    if (!['START', 'PAUSE', 'RESUME', 'CHAT', 'PROPOSE', 'VOTE', 'CARD', 'CONTINUE', 'ASSASSINATE'].includes(body.type)) return json({ error: '허용되지 않는 행동입니다.' }, 400);
    if (body.type === 'CHAT') {
      const text = String(body.text ?? '').trim();
      if (!text || text.length > 280) throw new Error('채팅은 1~280자여야 합니다.');
      // Save the human interruption before another model call can publish an obsolete reply.
      const next = apply(game, 'human', { ...body, text, speechAct: 'OTHER' });
      await save(game, next, 'human', 'CHAT', { length: text.length, speechAct: 'OTHER', classifierMode: 'immediate', policyVersion: AI_POLICY_VERSION });
      return json({ game: view(next), aiMode: aiMode() });
    }
    const next = apply(game, 'human', body);
    await save(game, next, 'human', body.type);
    return json({ game: view(next), aiMode: aiMode() });
  } catch (error) {
    if ((error as { code?: string })?.code === 'STALE_STATE') {
      const current = await readGame(request);
      if (current) return json({ error: '상태가 변경됐습니다. 다시 처리합니다.', game: view(current) }, 409);
    }
    console.error(JSON.stringify({ event: 'game_action_failure', message: String(error) }));
    return json({ error: error instanceof Error ? error.message : '요청 실패' }, 400);
  }
}
