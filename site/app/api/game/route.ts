import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { createGame, observe, apply } from '../../../lib/game.mjs';
import { AI_MODEL, AI_POLICY_VERSION, PROMPT_VERSION, decide, idleDueAt, nextAiAction } from '../../../lib/ai.mjs';
import { gameLog } from '../../../lib/game-log.mjs';
import {rememberThinking,thinkingDetail} from '../../../lib/thinking-memory.mjs';
import { rememberAction, ACTION_SELECTION_VERSION } from '../../../lib/action-selection.mjs';
import { ROLE_GUESS_VERSION } from '../../../lib/role-guess.mjs';
import { loggedDecisionEvidence } from '../../../lib/evidence.mjs';
import { newGameRoutingMode, routingNotice, ROUTING_VERSION, JEV_MODEL, baselineDiscussion } from '../../../lib/discussion-routing.mjs';
import { humanNeedsReply } from '../../../lib/conversation.mjs';
import {gameUsage,recordUsage,acquireAiLease,releaseAiLease} from '../../../lib/usage.mjs';

export const runtime = 'edge';
const cookie = 'avalon_game';
const modelCredential = () => env.VERTEX_PROXY_URL && env.VERTEX_PROXY_TOKEN
  ? { url: env.VERTEX_PROXY_URL, token: env.VERTEX_PROXY_TOKEN }
  : env.GEMINI_API_KEY;
const aiMode = () => modelCredential() ? 'gemini' : 'practice';
const defaultRoutingMode = () => env.AVALON_ROUTING_MODE ?? (routingReady()?'jev':'baseline');
const routingReady = () => !!(env.TYPESAFE_API_KEY && modelCredential());

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

async function view(game: any) {
  const playerView = observe(game);
  const usage=await gameUsage(env.DB!,game);
  return { ...playerView,usage:usage.summary, aiPending: !!nextAiAction(game), idleDueAt: idleDueAt(game), routingMode: game.aiConfig?.routingMode ?? 'baseline', actionMode: game.aiConfig?.actionMode ?? 'gemini' };
}

async function readGame(request: NextRequest) {
  const id = request.cookies.get(cookie)?.value;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = await env.DB!.prepare('SELECT state FROM games WHERE id = ?').bind(id).first<{ state: string }>();
  if(!row)return null;
  const game=JSON.parse(row.state);
  // Existing sessions adopt the manual policy without a destructive restart.
  game.aiConfig={...game.aiConfig,manualProgress:true,conversationVersion:1};
  game.conversation={burst:0,turns:0,revisions:0,...game.conversation,voteAt:null,continueAt:null,deferUntil:null};
  if(game.paused&&game.pauseSource==='reading'){game.paused=false;game.pausedAt=null;game.pauseSource=null;}
  return game;
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
          routingMode: game.aiConfig.routingMode ?? 'baseline', routingVersion: game.aiConfig.routingVersion ?? null,
          actionMode: game.aiConfig.actionMode ?? 'gemini', actionSelectionVersion: game.aiConfig.actionSelectionVersion ?? null,
          ...(game.phase === 'ENDED' ? { proposalPolicy: game.aiConfig.proposalPolicy } : {}) } : null,
        events: eventRows.results, aiFailures: failureRows.results,
        ...(game.phase==='ENDED'?{aiThinking:(await gameUsage(env.DB!,game)).records.filter((record:any)=>typeof record.thinking==='string')}: {}) };
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
    return json({ game: game ? await view(game) : null, aiMode: aiMode(), routingReady: routingReady() });
  } catch (error) {
    console.error(JSON.stringify({ event: 'game_read_failure', message: String(error) }));
    return json({ error: '게임을 불러오지 못했습니다.' }, 503);
  }
}

export async function POST(request: NextRequest) {
  let leasedGameId:string|null=null,leaseOwner:string|null=null;
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: '요청 출처가 맞지 않습니다.' }, 403);
    const body: any = await request.json();
    if (body.type === 'NEW') {
      const routingMode = newGameRoutingMode(body.routingMode, defaultRoutingMode());
      const actionMode = body.actionMode ?? (routingMode === 'jev' ? 'jev' : 'gemini');
      if (!['gemini','jev'].includes(actionMode)) return json({ error: '행동 선택 방식을 확인해 주세요.' }, 400);
      if (routingMode !== 'baseline' && !routingReady()) return json({ error: 'JEV와 대화 AI 연결 설정을 확인해 주세요. 기존 방식으로 시작할 수 있습니다.' }, 503);
      if (actionMode === 'jev' && !routingReady()) return json({ error: 'JEV 연결 설정을 확인해 주세요.' }, 503);
      const previous = await readGame(request);
      if (previous && previous.phase !== 'ENDED') {
        if (body.version !== previous.version) return json({ error: '상태가 변경됐습니다. 다시 확인하세요.', game: await view(previous) }, 409);
        const archived = { ...previous, version: previous.version + 1, phase: 'ENDED', winner: null,
          endReason: 'RESTARTED', archivedFromPhase: previous.phase, paused: false };
        await save(previous, archived, 'human', 'GAME_RESTARTED');
      }
      const game = { ...createGame(), aiConfig: { policyVersion: AI_POLICY_VERSION, promptVersion: PROMPT_VERSION,
        routingMode, routingVersion: ROUTING_VERSION, routingModel: JEV_MODEL,
        actionMode, actionSelectionVersion: actionMode === 'jev' ? ACTION_SELECTION_VERSION : null, actionModel: actionMode === 'jev' ? JEV_MODEL : AI_MODEL, roleGuessVersion: ROLE_GUESS_VERSION,
        conversationVersion:1,manualProgress:true,usageTrackingVersion:1,
        proposalPolicy: 'A',
        model: modelCredential() ? AI_MODEL : null } };
      const at = new Date().toISOString();
      await env.DB!.prepare('INSERT INTO games (id, version, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(game.id, game.version, JSON.stringify(game), at, at).run();
      await env.DB!.prepare('INSERT INTO events (game_id, version, actor, type, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(game.id, 0, 'system', 'GAME_CREATED', JSON.stringify(game.aiConfig), at).run();
      const response = json({ game: await view(game), aiMode: aiMode() });
      response.cookies.set(cookie, game.id, { httpOnly: true, secure: new URL(request.url).protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
      return response;
    }
    const game = await readGame(request);
    if (!game) return json({ error: '게임이 없습니다. 새 게임을 시작하세요.' }, 404);
    if (body.version !== game.version) return json({ error: '상태가 변경됐습니다. 다시 확인하세요.', game: await view(game) }, 409);
    if (body.type === 'ADVANCE') {
      const requestAction:any = nextAiAction(game);
      if (!requestAction) return json({ game: await view(game), aiMode: aiMode() });
      const started = Date.now();
      leaseOwner=await acquireAiLease(env.DB!,game);
      if(!leaseOwner)return json({game:await view(game),aiMode:aiMode(),retryAfterMs:1500});
      leasedGameId=game.id;
      let stage = 'model';
      let routingRecord: any = null;
      const routingOutcome = (outcome: string) => {
        if (routingRecord) console.info(JSON.stringify({ event: 'discussion_routing', ...routingRecord, outcome }));
      };
      try {
        const config={key:env.TYPESAFE_API_KEY,onUsage:(record:any)=>recordUsage(env.DB!,game,record),
          onRouting:(record:any)=>{routingRecord=record;routingOutcome('REQUESTED');}};
        let decision = requestAction.actor==='system'&&['SILENCE','START_VOTE','ANNOUNCE_VOTE','ANNOUNCE_CONTINUE','CONTINUE'].includes(requestAction.type)
          ? {actor:'system',action:{type:requestAction.type,...(requestAction.idleTrigger?{idleTrigger:true}:{})},mode:game.aiConfig?.manualProgress?'discussion-complete':requestAction.recoveryReason?'automatic-recovery':'scheduled-progress'}
          : await decide(game,requestAction,modelCredential(),null,config);
        let next;
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = await readGame(request);
          if (current && current.version !== game.version) { routingOutcome('DISCARDED'); return json({ game: await view(current), aiMode: aiMode() }); }
          stage = 'validation';
          try { next = apply(game, decision.actor, decision.action); break; }
          catch (error) {
            if (requestAction.type !== 'PROPOSE' || (error as Error).message !== '팀 인원이 맞지 않습니다.' || !modelCredential() || attempt === 2) throw error;
            await recordModelFailure(game, requestAction.actor, requestAction.type, stage, error, started);
            stage = 'model';
            if (attempt === 0) {
              try { decision = await decide(game, { ...requestAction, retryReason: 'INVALID_TEAM' }, modelCredential(),null,config); }
              catch (retryError) {
                await recordModelFailure(game, requestAction.actor, requestAction.type, 'model', retryError, started);
                decision = { ...await decide(game, requestAction, null,null,{practiceOnly:true}), mode: 'fallback' };
              }
            } else decision = { ...await decide(game, requestAction, null,null,{practiceOnly:true}), mode: 'fallback' };
          }
        }
        const { actor, action, usage, mode, plan } = decision;
        stage = 'save';
        rememberThinking(next,decision);
        rememberAction(next,decision);
        await save(game, next, actor, action.type, { aiMode: mode, policyVersion: AI_POLICY_VERSION, promptVersion: PROMPT_VERSION,
          ...(decision.routing ? { routing: decision.routing } : {}), recoveryReason:requestAction.recoveryReason??decision.routing?.recoveryReason??null,
          ...(decision.selection ? { selection: decision.selection } : {}), actionMode: game.aiConfig?.actionMode ?? 'gemini',
          proposalPolicy: game.aiConfig?.proposalPolicy ?? 'A', ...thinkingDetail(decision), evidence: loggedDecisionEvidence(decision), ...(plan ? { plan } : {}),
          model: mode === 'gemini' ? AI_MODEL : mode === 'jev' ? JEV_MODEL : null, speechAct: action.type === 'CHAT' && 'speechAct' in action ? action.speechAct : null,
          inputTokens: usage?.input ?? null,
          outputTokens: usage?.output ?? null, latencyMs: usage?.latencyMs ?? null, modelRetries: usage && 'retries' in usage ? usage.retries : 0 });
        routingOutcome('PUBLISHED');
        const notice = routingNotice(decision.routing) ?? (decision.selection && mode === 'fallback' ? 'JEV 행동 선택을 사용할 수 없어 이번 선택은 기본 규칙으로 처리했습니다. 오류와 대체 처리를 기록했습니다.' : mode === 'fallback' ? 'AI가 유효한 선택을 만들지 못해 기본 규칙으로 처리했습니다.' : null);
        return json({ game: await view(next), aiMode: aiMode(), ...(notice ? { notice } : {}) });
      } catch (error) {
        if ((error as { code?: string })?.code === 'STALE_STATE') {
          routingOutcome('DISCARDED');
          const current = await readGame(request);
          if (current) return json({ game: await view(current), aiMode: aiMode() });
        }
        if (stage !== 'save' && modelCredential())
          await recordModelFailure(game, requestAction.actor ?? 'system', requestAction.type, stage, error, started);
        if (requestAction.type === 'DISCUSS' && stage !== 'save') {
          const current = await readGame(request);
          if (current && current.version !== game.version) { routingOutcome('DISCARDED'); return json({ game: await view(current), aiMode: aiMode() }); }
          routingOutcome('GENERATION_FAILURE');
          const needsFallback=game.aiConfig?.conversationVersion&&(humanNeedsReply(game)||requestAction.recoveryReason);
          const selected=(error as any)?.actor??routingRecord?.selectedActor;
          const actor=needsFallback?(['ai1','ai2','ai3','ai4'].includes(selected)?selected:baselineDiscussion(game,requestAction).actor):'system';
          const action=needsFallback?{type:'CHAT',text:'응답을 생성하지 못했어요. 현재 공개된 팀과 결과를 기준으로 토론을 이어가겠습니다.',speechAct:'OTHER',replyTo:requestAction.replyTo??null,...(requestAction.idleTrigger?{idleTrigger:true}:{})}:{type:'SILENCE',idleTrigger:true};
          const next = apply(game, actor, action);
          await save(game, next, actor, action.type, { reason: 'MODEL_FAILURE',aiMode:'fallback',recoveryReason:needsFallback?'REPLY_GENERATION_FAILURE':null,errorCode: (error as { code?: string })?.code ?? 'INVALID_ACTION', policyVersion: AI_POLICY_VERSION,
            ...(routingRecord ? { routing: { ...routingRecord, outcome: 'GENERATION_FAILURE' } } : {}),
            actor: (error as any)?.actor ?? null, expectedType: (error as any)?.expectedType ?? null, returnedType: (error as any)?.returnedType ?? null,
            finishReason: (error as any)?.finishReason ?? null, responseChars: (error as any)?.responseChars ?? null, outputTokens: (error as any)?.outputTokens ?? null });
          return json({ game: await view(next), aiMode: aiMode(), notice: 'AI 발언에 오류가 있어 이번 발언을 건너뛰었습니다. 게임은 계속 진행됩니다.' });
        }
        if (stage !== 'save' && requestAction.actor && ['PROPOSE', 'VOTE', 'CARD', 'ASSASSINATE'].includes(requestAction.type)) {
          // Recheck after the failed call: never overwrite a pause, chat, or newer action.
          const current = await readGame(request);
          if (current && current.version !== game.version) return json({ game: await view(current), aiMode: aiMode() });
          const fallback = await decide(game, requestAction, null,null,{practiceOnly:true});
          const next = apply(game, fallback.actor, fallback.action);
          rememberAction(next,{...fallback,mode:'fallback'});
          await save(game, next, fallback.actor, fallback.action.type, { aiMode: 'fallback', reason: 'MODEL_FAILURE',
            evidence: loggedDecisionEvidence({ ...fallback, mode: 'fallback' }), errorCode: (error as { code?: string })?.code ?? 'INVALID_ACTION', policyVersion: AI_POLICY_VERSION, promptVersion: PROMPT_VERSION });
          return json({ game: await view(next), aiMode: aiMode(), notice: 'AI 요청에 실패해 이번 행동은 기본 규칙으로 처리했습니다. 기록에 오류와 대체 처리를 남겼습니다.' });
        }
        throw error;
      }
    }
    if (!['START', 'PAUSE', 'RESUME', 'CHAT', 'PROPOSE', 'START_VOTE', 'REQUEST_REVISION', 'VOTE', 'CARD', 'CONTINUE', 'ASSASSINATE','DEFER_VOTE','HUMAN_ACTIVE','ROLE_GUESS'].includes(body.type)) return json({ error: '허용되지 않는 행동입니다.' }, 400);
    if(body.type==='HUMAN_ACTIVE'&&(!game.aiConfig?.conversationVersion||!['PROPOSE','TEAM_DISCUSSION','VOTE_RESULT','QUEST_RESULT'].includes(game.phase)))return json({game:await view(game),aiMode:aiMode()});
    if (body.type === 'CHAT') {
      const text = String(body.text ?? '').trim();
      if (!text || text.length > 280) throw new Error('채팅은 1~280자여야 합니다.');
      // Save the human interruption before another model call can publish an obsolete reply.
      const next = apply(game, 'human', { ...body, text, speechAct: 'OTHER' });
      await save(game, next, 'human', 'CHAT', { length: text.length, speechAct: 'OTHER', classifierMode: 'immediate', policyVersion: AI_POLICY_VERSION });
      return json({ game: await view(next), aiMode: aiMode() });
    }
    const next = apply(game, 'human', body);
    await save(game, next, 'human', body.type, body.type === 'ROLE_GUESS' ? { roleGuess: next.roleGuess } : {});
    return json({ game: await view(next), aiMode: aiMode() });
  } catch (error) {
    if ((error as { code?: string })?.code === 'STALE_STATE') {
      const current = await readGame(request);
      if (current) return json({ error: '상태가 변경됐습니다. 다시 처리합니다.', game: await view(current) }, 409);
    }
    console.error(JSON.stringify({ event: 'game_action_failure', message: String(error) }));
    return json({ error: error instanceof Error ? error.message : '요청 실패' }, 400);
  } finally {
    if(leasedGameId&&leaseOwner)await releaseAiLease(env.DB!,leasedGameId,leaseOwner);
  }
}
