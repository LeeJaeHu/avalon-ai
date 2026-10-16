# 로컬 V3 아발론

프로젝트 최상위에서 `node prototype/server.mjs`를 실행하고 http://127.0.0.1:5174 를 연다. Node 22.13 이상을 사용한다. 서버를 켜 둔 동안 이 컴퓨터에서 접근할 수 있다. 기존 Sites 배포나 5173 미리보기와 별도다.

`prototype/.env.local`의 `VERTEX_PROXY_URL`·`VERTEX_PROXY_TOKEN` 또는 `GEMINI_API_KEY`를 읽는다. 값은 브라우저로 전달하지 않으며 Git에서 제외한다. 키가 없으면 화면에 **연습 모드 · 모델 미연결**이 표시되고 기본 규칙 AI가 동작한다. 연습 모드는 V3 대화 품질 체험이 아니다.

1. 원탁에 앉기 → 비밀 역할 확인 → 시작.
2. 팀 초안을 공유하고 채팅한다. AI 발언의 ‘답하기’로 질문 대상을 지정할 수 있다.
3. ‘다른 AI 의견 듣기’로 추가 반응을 요청하거나 AI 리더에게 팀 재검토를 요청한다.
4. ‘이 팀으로 투표 시작’ → 비밀 찬반 → 전원 공개 → 원정 카드 → 결과 확인.
5. 종료 후 로그 다운로드. 새 판을 시작할 때도 기존 판을 중단 기록으로 보존한다.

모델 호출은 시작/필수 행동/질문/추가 의견 때 발생한다. 무한 AI 대화와 8초 자동 idle 호출은 이 프로토타입에서 실행하지 않는다. 사용자 입력으로 바뀐 상태에는 이전 버전 AI 응답을 게시하지 않는다. 실시간 자동 모델 평가는 없으며 플레이 횟수에 따라 모델 사용 비용이 발생한다.

상태는 `.local-prototype/session.json`, 종료 로그는 `logs/prototype/avalon-<gameId>.json`에 저장된다. 한 로컬 세션을 모든 탭이 공유한다. 상태와 로그는 역할·채팅·비밀 카드를 포함하므로 Git에 넣지 않는다. 상세 thinking은 저장하지 않는다. evidence는 종료 로그의 사건 detail에만 남으며 자기보고 설명이다.

V3 실제 실행 연결: `server.mjs` → `decide(..., buildHumanlikeTurn)` → V3 문맥/프롬프트/응답 스키마 → 기존 Gemini 요청 → 기존 규칙 검사 → 버전 확인 → 저장. 기존 사이트는 빌더 인수를 전달하지 않아 V2를 유지한다.

검사: `node --test prototype/*.test.mjs site/tests/*.test.mjs scripts/*.test.mjs`. 실제 연결 검사는 `node prototype/live-check.mjs`이며 명시적 호출 상한 설정 없이는 실행되지 않는다.

## JEV 발언 판단과 비교

`prototype/.env.local` 또는 서버 환경 변수에 `TYPESAFE_API_KEY`를 설정한 뒤 서버를 재시작한다. 키는 채팅·Git에 넣지 않는다. Gemini 연결도 있어야 유료 JEV 호출을 한다. 키만 설정하면 새 판의 기본값은 JEV 적용이며, `AVALON_ROUTING_MODE=shadow`로 비교 모드를 기본값으로 지정할 수 있다. 기존 판은 생성 당시 모드를 유지한다.

화면의 **다음 판의 발언 판단**에서 선택한 뒤 새 게임을 시작한다.

- **기존 방식**: 기존 발언자 선택, JEV 호출 없음.
- **기존 유지 + JEV 비교 기록**: 같은 공개 상황에서 기존 선택과 JEV 선택을 기록하고 실제 발언은 기존 AI가 한다. 먼저 이 모드에서 질문 대상이 맞는지 비교하는 것을 권장한다.
- **JEV 적용**: JEV 응답 후보를 사용한다. 대기를 선택하면 Gemini 생성을 생략한다. 직접 답장을 지정했으면 해당 AI를 유지하며 JEV를 호출하지 않는다.

JEV 키 없음·3초 시간 초과·HTTP 오류·잘못된 응답은 기존 방식으로 대체한다. 자동 재시도는 없다. 선택 확률에 별도 임계값을 강제하지 않는다. JEV의 발언 태그 추정은 분석에만 사용하며 사람 발언이나 플레이어 목적을 덮어쓰지 않는다.

종료 화면에 선택 차이·호출·대체·폐기·대기로 생략한 생성·확인된 JEV 비용을 표시한다. 다운로드 로그의 `routingAttempts`는 결과를 게시하지 못한 요청도 포함한다. 오래된 결과는 `DISCARDED`, Gemini 실패는 `GENERATION_FAILURE`다. 사용량 미확인 호출은 비용 0으로 단정하지 않고 별도로 센다. 개별 JEV 판단은 플레이 중 공개하지 않는다.

여러 종료 로그 비교:

```powershell
node scripts/compare-routing.mjs logs/prototype/avalon-첫게임ID.json logs/prototype/avalon-둘째게임ID.json
```

스크립트는 API를 호출하지 않는다. 선택 차이는 품질 개선율이 아니다. shadow는 기존 대화 흐름에서 비교하고, JEV 적용 판과 기존 판은 후속 대화가 달라 단순 승률 차이를 효과로 해석할 수 없다. 과거 로그의 JEV 판단은 복원하지 않는다. 상세 기준은 `docs/specs/016-jev-discussion-routing.md`에 있다.

확인용 5175 서버는 Gemini/JEV를 연결하지 않은 연습 화면이며 상태 디렉터리 `.local-prototype/jev-preview/`를 사용한다. 일반 5174 서버의 상태와 분리한다. 실제 호출은 환경 설정을 읽는 `node prototype/server.mjs`로 실행한다.
