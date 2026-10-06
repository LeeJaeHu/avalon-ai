# 게임 기록과 운영 관측

## JEV 발언 판단 비교 기록

2026-10-03 로컬 소스에 baseline/shadow/jev 라우팅을 추가했다. 운영 배포는 아직 하지 않았다. 공개 관찰값으로만 다음 응답 후보/대기와 발언 태그를 추정하며 플레이어 전략은 기존 모델이 정한다. 질문 버전 `jev-discussion-v1`, 모델 `jev-1.13.0`을 기록한다.

로컬 `routingAttempts`에는 gameId/stateVersion/메시지 ID/입력 해시/기존·JEV·적용 선택/확신도·확률/사용량·지연/상태·게시 결과를 저장한다. trace는 같은 시도 ID와 상태 버전으로 판단→생성→게시 또는 폐기를 연결한다. log는 NO_KEY/FALLBACK/DISCARDED/GENERATION_FAILURE 등을 구분한다. metric은 `summarizeRouting`과 `scripts/compare-routing.mjs`로 호출·불일치·대체·생략한 생성·알려진 비용·사용량 미확인 호출·지연 p50/p95를 계산한다. 입력 원문/키/오류 원문/비밀 관찰은 이 기록에 복사하지 않는다. 종료 전 API에서 개별 비교 판단을 공개하지 않는다.

Sites 서버 연결은 `TYPESAFE_API_KEY`와 `AVALON_ROUTING_MODE` 환경 설정을 사용한다. 새 판부터 설정을 고정하고 기존 판은 baseline을 유지한다. 성공/생성 실패 판단은 사건 detail.routing으로 저장한다. 폐기된 요청은 DB 사건에 저장하지 않고 서버의 discussion_routing 로그에서 REQUESTED→DISCARDED로 구분한다. 서버 로그 수집·보관 인프라는 이번에 추가하지 않았다. 따라서 Sites 종료 로그만으로는 폐기된 호출 비용을 완전히 집계할 수 없다. 요청 동시 실행은 기존 상태 버전 저장 검사로 중복 게시를 막지만 Sites의 모델 호출 자체를 한 번으로 합치는 기능은 이번에 추가하지 않았다. 로컬 서버는 기존 단일 inFlight 잠금을 유지한다.

비용은 확인된 input_tokens×$0.042/백만 토큰이다. Gemini/호스팅 비용을 포함하지 않는다. 불일치는 개선율이 아니며, 모의 응답 검사 통과는 실제 JEV의 한국어 정확도·대화 품질·운영 성과를 증명하지 않는다. 구현·비교 한계는 `docs/specs/016-jev-discussion-routing.md`를 참조한다.

## 실제 저장 구조

게임은 Sites D1의 `games` 테이블에 상태 JSON으로 저장된다. 게임 ID는 브라우저의 HttpOnly 쿠키에 보관한다. 채팅 원문은 대화 재표시와 AI 문맥을 위해 게임 상태에 포함된다. 역할, 비밀 투표, 임무 카드는 서버 상태에만 있으며 `observe()`가 본인에게 허용된 정보만 응답한다.

`events` 테이블은 서버가 **수락한 의미 있는 행동**을 게임 ID·상태 버전·행동 주체·종류·시각으로 기록한다. 현재 종류는 `GAME_CREATED`, `CHAT`, `SILENCE`, `PROPOSE`, `VOTE`, `CARD`, `ASSASSINATE` 등이다. `SILENCE`는 AI가 새 발언을 하지 않거나 선택적인 토론 발언 생성이 실패해 해당 발언을 건너뛴 경우다. 후자는 상세에 `reason=MODEL_FAILURE`와 오류 코드가 남는다. 채팅 이벤트에는 글자 수·`speechAct`를, 모델을 사용한 이벤트에는 모드·정책/모델 버전·토큰 수·지연 시간도 기록한다. JSON 형식 오류 재시도에 사용한 토큰은 현재 이벤트 사용량에 합산되지 않고, 실패 호출은 `ai_failures`의 지연과 오류 코드로만 확인할 수 있다. 원문, 역할표, 비밀 카드, API 키는 이벤트 상세에 넣지 않는다. 화면의 모든 탭·스크롤 같은 클릭은 게임 분석에 필요하지 않아 수집하지 않는다. 클라이언트 전송 실패나 아직 제출하지 않은 선택은 기록되지 않는다.

`games.state`는 파일이 아니라 D1의 `games` 테이블 `state` JSON 열이다. 로컬 미리보기 DB는 `site/.wrangler/state/` 아래에 있고, 배포된 Sites의 D1은 별도다. 새 판에는 `aiConfig.policyVersion`과 모델 ID를 저장하며 `GAME_CREATED`와 성공한 AI 행동 이벤트에도 실행 당시 버전을 넣는다. 과거 판에는 이 필드가 없을 수 있다. 모델 호출 또는 AI 행동 검증이 실패하면 별도 `ai_failures` 테이블에 게임 ID·상태 버전·요청 행동·단계·오류 코드·정책/모델 버전·지연·시각만 기록한다. 잘못된 팀 제안은 `INVALID_TEAM`으로 기록하며 모델 재요청도 실패하면 두 실패를 각각 남긴 뒤 기본 전략으로 진행한다. 사람 발언은 빠른 저장을 위해 별도 모델 분류 없이 `OTHER`, `classifierMode=immediate`로 기록한다. 저장 실패 자체와 연습 모드 오류는 `ai_failures`의 대상이 아니다. 원문 프롬프트·응답·키는 저장하지 않는다. 배포 DB에는 마이그레이션 `site/drizzle/0001_burly_dracula.sql` 적용이 필요하다.

새 사람·AI 채팅은 모두 `actor`와 `speechAct`를 메시지에 저장한다. `actor`는 서버가 정하는 플레이어 ID로, `human`은 사람이고 `ai1`~`ai4`는 해당 번호의 AI 플레이어다. 채팅 `events.actor`에도 같은 ID가 저장된다. 모델이 발언자를 출력하거나 사용자가 임의 지정하지 않는다. 현재 사람 발언의 태그는 즉시 저장을 위해 `OTHER`이고, AI 발언 태그는 모델 출력이다. 태그는 발언 목적의 추정이며 의미나 역할에 대한 확정 판정이 아니다. 이전 버전의 채팅에는 태그가 없을 수 있다. 역할 후보의 플레이어별 악 비율과 팀 내 악 인원수별 후보 비율은 `site/lib/belief.mjs`에서 현재 관찰값으로 즉석 계산해 AI 모델에 전달하며 DB와 사람 화면에는 별도 저장하지 않는다.

로컬 판의 메타데이터 조회 예시(`site/`에서 실행):

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --command "SELECT id, version, json_extract(state, '$.phase') AS phase, json_extract(state, '$.aiConfig.policyVersion') AS policy_version FROM games ORDER BY created_at DESC LIMIT 10"
```

전체 `state`에는 채팅 원문과 비밀 역할·카드가 있으므로 출력·공유에 주의한다. 배포 DB는 Sites 프로젝트의 DB `games`/`events`/`ai_failures` 테이블에서 소유자 권한으로 확인한다. 로컬 DB 명령에 `--remote`를 붙인다고 Sites 배포 DB로 전환되는 것은 아니다.

종료 화면의 **게임 기록 JSON 다운로드**를 누르면 현재 브라우저 쿠키가 가리키는 종료 판의 전체 게임 상태, 버전 순 사건 기록, AI 오류 기록을 `avalon-<game-id>.json`으로 저장할 수 있다. 파일의 `format`은 `avalon-game-log-v1`이다. 진행 중인 판은 내려받을 수 없고, 새 게임을 시작하면 쿠키가 새 판으로 바뀌므로 먼저 내려받아야 한다. 브라우저 다운로드 폴더와 경로는 브라우저 설정에 따르며 자동 동기화나 이전 판 목록은 아직 없다. 파일에는 채팅 원문·역할·개별 임무 카드가 있으므로 저장·공유에 주의한다. 로그인 없이도 채팅에 입력한 이름·연락처 등은 개인 정보가 될 수 있다.

게임 중이나 오류 화면에서 상단 **진단 로그**를 누르면 현재 판의 단계·버전, 성공 사건의 시각과 종류, AI 실패의 단계·코드·시각을 `avalon-diagnostics-<game-id>.json`으로 내려받는다. `format=avalon-diagnostics-v1`이며 역할표·채팅 원문·카드 원문은 포함하지 않는다. 실패한 모델 출력 원문도 저장하지 않는다. AI 실패는 성공 사건과 별도 테이블에 기록되므로 재시도나 게임 재시작으로 지워지지 않는다. 다만 새 게임을 시작하면 현재 쿠키가 새 판을 가리켜 이전 판의 진단 파일을 화면에서 다시 내려받을 수 없다. 이전 판을 나중에 찾으려면 안정적인 브라우저 세션 ID와 게임 목록 조회를 별도로 구현해야 한다. 현재는 새 게임 전에 진단 파일을 저장하거나 소유자가 배포 D1에서 게임 ID로 조회한다.

## trace · log · metric

- Trace 연결: `game_id → version → actor/type`. `events`의 연속 버전으로 상태 전이를 따라간다. 별도 분산 추적 시스템은 아직 없다.
- Log: API 읽기/행동 실패는 서버 `console.error`에 사건명과 오류만 남긴다. 사용자 채팅 원문은 출력하지 않는다.
- Metric: `events`를 종류별로 집계해 투표·임무·채팅 횟수와 판 완주를 계산한다. 모델 호출 토큰·지연은 AI 행동 이벤트에서 합산할 수 있다. 대시보드와 알림은 아직 없다.

## 개선 실험에 필요한 기록 수준

현재 `events`는 수락된 행동과 상태 버전을, `ai_failures`는 일부 실패 시도의 오류 코드·지연을 기록한다. 이것으로 판의 흐름과 호출 비용 일부를 추적할 수 있지만, 진행자 판단과 플레이어 발언의 호출량은 한 사건에 합산되고 모델 입력 사건 ID→출력 검증→상태 반영의 개별 단계는 완전한 trace로 남지 않는다. 따라서 **운영 관측 시스템을 완성했다**거나 **AI 성능 개선을 측정했다**고 주장하지 않는다.

- **게임 기능 확인:** 판 ID·정책 버전·모드별 완료 여부, 규칙/비밀 경계 검사와 배포 화면의 실제 완주 결과를 연결한다. 자동 검사와 사람의 화면 확인을 구분한다.
- **확률모형 평가:** 종료 판의 공개 시점 관찰값과 실제 역할 정답을 분리해 보관·채점한다. 학습 판/검증 판/최종 평가 판의 ID, 모형 계수 버전, 판당 Brier·로그 손실과 제외 사유를 재현 가능한 실행 결과로 남긴다. 상세 절차는 `specs/005-belief-learning-experiment.md`다.
- **AI 정책 비교:** 각 모델 판단의 요청 단계·허용된 공개 사건 ID·배우·정책/모형 버전·응답 유효성·오류 코드·토큰·지연을 비밀 정보와 원문 프롬프트 없이 연결할 수 있게 보강한다. 고정 시나리오의 역할별 결과와 질문 응답/근거 오류의 표본 판정을 버전별로 비교한다. 실제 측정·사람 검토가 없으면 `미실시`로 적는다.

예시 쿼리:

```sql
SELECT type, COUNT(*) AS count FROM events GROUP BY type;
SELECT game_id, MAX(version) AS last_version,
       SUM(type = 'CHAT') AS chats,
       SUM(type = 'VOTE') AS votes
FROM events GROUP BY game_id;
SELECT game_id, state_version, request_type, error_code, policy_version, at
FROM ai_failures ORDER BY at DESC LIMIT 20;
SELECT events.game_id, events.version, events.actor AS speaker_id,
       json_extract(events.detail, '$.speechAct') AS speech_act, events.at
FROM events WHERE events.type = 'CHAT' ORDER BY events.at DESC LIMIT 20;
```

## 개인정보와 운영 한계

2026-10-06 새 판은 `usageTrackingVersion=1`을 고정한다. `model_usage`는 Gemini/JEV의 각 전송을 UUID로 기록하고 REQUESTED에서 최종 상태로 갱신한다. 재시도·잘못된 응답·게시 전 폐기에도 사용량을 보존한다. Gemini 입력/응답/추론/캐시/전체 토큰과 가격 버전을 남기며 프롬프트·응답 원문·인증 정보는 이 테이블에 저장하지 않는다. 화면의 `usageSummary`는 공급자별 호출·토큰·추정 비용·미확인 호출을 집계하고, 종료 또는 보관 판 JSON에는 `modelUsage`와 같은 합계를 포함한다. 이전 판의 누락 기록은 `legacyIncomplete`로 표시한다. 비용은 고정 Global 일반 단가의 USD 추정이며 중계·호스팅·실제 청구 조건을 포함하지 않는다.

같은 판의 모델 호출은 `ai_locks`의 180초 임대로 제한하며 소유자만 해제한다. 사람 입력으로 버전이 바뀌면 이미 생성된 답변은 게시하지 않는다. 사용량 시도는 남고 폐기 사건은 기존 서버 trace와 연결된다. JEV 진행 판단에는 `progress`/`progressVersion`을 남긴다. 자동 검사는 `site/tests/usage.test.mjs`, `site/tests/conversation.test.mjs`; 실제 짧은 연결 확인은 `site/tests/live-routing-smoke.mjs`이며 전체 게임 품질 평가와 구분한다.

2026-10-04부터 운영판 새 게임은 `aiConfig.routingMode`로 기존/JEV 방식을 고정한다. `GAME_CREATED` 사건과 종료 로그에 모드를 남기고 AI 토론 사건의 `detail.routing`에 시도 ID·입력 해시·기존/JEV/적용 발언자·판별 버전·상태·확률·입력 토큰·지연·추정 비용을 기록한다. 대국 중 진단 파일에는 모드/판별 버전만 추가하며 상세 판단은 종료 로그에서 확인한다. JEV 요청/게시/생성 실패/폐기 단계는 서버 구조화 로그의 같은 시도 ID로 연결한다. 폐기된 요청은 서버 로그에만 있어 종료 JSON 집계에서는 빠진다. `scripts/compare-routing.mjs`는 종료 JSON의 사건 기록도 집계하며 선택 차이를 품질 개선으로 해석하지 않는다. 실제 연결 smoke의 수치와 판 ID는 `specs/016-jev-discussion-routing.md`에 있다.

새 사이트는 소유자 전용 비공개 접근이다. GitHub 저장소에도 실제 게임 데이터는 올리지 않는다. 개인 이름이나 민감한 내용을 채팅에 입력하지 않는 것이 좋다. 현재 자동 보관 기한·삭제 UI·동의 화면·외부 분석 도구는 없다. 다른 이용자에게 사이트를 공유하기 전에 사용자 식별·삭제 요청·보관 기한을 구현해야 한다. 원문을 포트폴리오 사례에 옮길 때는 이용 권한과 개인정보를 별도로 확인한다.

## JEV 개인 행동과 역할 식별 결과 (2026-10-06)

행동 선택의 trace는 gameId/stateVersion/actor/requestType → `selection.id`/inputHash → JEV 선택 또는 오류 → 서버 검증/버전 재확인 → 상태 적용으로 연결한다. 개인 행동 사건의 `detail.selection`은 선택 ID·후보 수·분포·확신도·모델·판별 버전·사용량·지연·대체 여부를 기록한다. JEV 전송도 기존 model_usage UUID의 REQUESTED/최종 상태를 갱신하므로 폐기/실패 사용량을 포함한다. 선의 성공 제출은 RULE이며 모델 호출로 세지 않는다. JEV는 thinking 문장을 생성하지 않는다. Gemini 대화의 명시적 thinking 자기보고와 본인의 직전 생각 기억은 유지하고 실제 선택은 별도 privateActions에 보존한다.

`ROLE_GUESS` 사건과 종료 로그의 roleGuess에 AI4명의 추측·개별 정오·correct/total·원정 수·사용자 역할/시작 지식·시작 aiConfig를 저장한다. 점수와 정체는 ENDED 전의 일반 응답·진단·AI 입력에서 제외한다. 기존 D1 games.state/events.detail에 저장하며 별도 테이블이나 마이그레이션은 없다. 5연속 부결·중도 재시작은 추측 미실시로 구분한다. 정답률은 사용자 경험과 시작 정보·악의 기만에도 좌우되며 승률·전략 품질과 구분해 조건별로 비교한다. 관련 반복 검사는 `site/tests/action-selection.test.mjs`, `site/tests/role-guess.test.mjs`, `site/tests/api-smoke.mjs`, `site/tests/ui-role-guess.mjs`다. 실제 모델 품질 비교는 미실시다.
