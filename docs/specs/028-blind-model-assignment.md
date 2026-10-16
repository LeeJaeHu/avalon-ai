# 50:50 모델 배정과 종료 후 모델 추측

- 새 판마다 서버의 암호학적 난수 한 번으로 Lite/Flash를 각각 50% 확률로 선택하고 aiConfig에 고정한다. 소수 판에서 실제 판수 균등은 보장하지 않는다.
- 진행 중 및 종료 후 추측 제출 전 모델명·사용량·진단/전체 다운로드를 공개하지 않는다. 운영 수집 로그는 실제 모델을 보존한다.
- 실제 모델을 사용하는 정상 완료 판에서 인간만 한 번 추측 가능하다. 재시작/연습/과거 수동 판은 추측 대상에서 제외한다. 미제출은 오답으로 처리하지 않는다.
- 추측 후 실제 모델과 정오를 공개한다. 비용·승률·진영/세부 역할 식별률과 모델 식별률을 따로 집계하고 수동/무작위 배정 조건을 분리한다.
- 자동 검증: 난수 양쪽 경계, 모델 고정, 인간 전용/종료 전/중복/잘못된 모델 거부, 관찰·진행자 입력 비공개, 집계 분모. 실패 시 수정 후 재실행한다. 실제 유료 모델 품질 평가는 이번 범위에서 실시하지 않는다.
- 사용자 판단: 모델을 게임 시작에 50% 무작위 선택하고 종료 후 어떤 모델 같았는지 고르게 하자고 제안했다. 모델 식별률은 체감 차이의 지표이며 높은 정답률 자체가 품질 우수함을 뜻하지 않는다는 해석은 Codex 제안이다.

## 구현·재현

- `site/lib/gemini-models.mjs`: 32비트 균등 난수의 절반 경계로 배정, `random-blind-v1` 기록. UI에서 모델을 지정하지 않고 서버가 결정한다. 기존 게임의 모델은 유지한다.
- `site/lib/game.mjs`, `site/app/api/game/route.ts`: 인간 전용 종료 후 1회 `MODEL_GUESS`, 낙관적 버전 검사 및 저장 이벤트 재사용. 인간 관찰만 추측 상태를 포함하고 AI/진행자에게는 제공하지 않는다. 추측 전 사용량은 null, 진단/전체 다운로드는 409이며 인증된 운영 수집은 유지한다.
- `site/lib/comparison.mjs`: `modelGuessGames`, `modelGuessCorrect`, `modelGuessAccuracy`(제출한 정상 완료 판 수가 분모). `modelAssignmentVersion`으로 기존 수동 판과 조건별 집계를 분리한다. 미제출은 null이다.
- `node --test site/tests/*.test.mjs scripts/*.test.mjs`: 131/131. TypeScript 검사·Worker 빌드 통과. 운영 소스 검사 116/116.
- 합성 UI `ui-comparison.mjs` PC/모바일 12상황, 기존 `ui-role-guess.mjs` 5상황 통과. 원문 없는 결과 `docs/review-assets/blind-model-2026-10-07/validation.json`, `docs/review-assets/blind-model-role-2026-10-07/validation.json`.
- 로컬 Worker 통합: 사이트 디렉터리에서 기존 3개 D1 마이그레이션 적용 후 서버를 127.0.0.1:5188에 시작하고 `node tests/api-model-guess.mjs`. 진행/종료 전후 비공개, 중복/동시 제출(200/409), 저장된 추측 및 다운로드 확인. 결과 `docs/review-assets/blind-model-2026-10-07/api-validation.json`. 유료 모델 호출 0; 품질 비교와 실제 사용자의 모델 식별은 미확인.

## 2026-10-07 — 모델·추론 조합 비교로 변경
- 사용자 선택: 실제4수준 파일럿의 비용/응답시간을 고려해 Flash-Lite MEDIUM과 Flash MINIMAL을 비교한다. LOW도 후보로 언급했으나 이번 구현 요청은 MINIMAL이다. 수준당1회 실험은 품질 우위의 증명이 아니며 비용·지연을 고려한 사용자의 현재 선택이다.
- 새 판에서 서버32비트 난수로 두 모델을50:50 배정하고, Lite=MEDIUM/Flash=MINIMAL/출력8192를 aiConfig에 고정한다. JSON thinking·기억 재입력과 JEV 구성은 유지한다. 모델/설정 클라이언트 지정은 받지 않는다.
- 대화·행동·인간 발언 분류·재시도에 동일 generationConfig를 사용한다. 중계는 추론 수준을 허용 목록으로 검사해 전달하고 출력 상한8192를 적용한다. 실행 중 과거 판은 기존768/기본 추론 설정을 유지한다. 기존 random-blind-v1도 계속 추측 전 숨기고 종료후 추측할 수 있다.
- 추측 전 모델·실제 추론 수준·사용량은 숨긴다. 선택지에는 두 조합을 표시하고 제출 후 실제 모델/추론 수준을 공개한다. 진단/다운로드의 기존409 보호는 유지한다.
- 버전: modelComparisonVersion=gemini-thinking-pair-v2, modelAssignmentVersion=random-blind-thinking-v2, geminiGenerationVersion=thinking-pair-v1. aiConfig와 호출 사용량에 추론 수준·출력 상한을 저장한다. 새 모델 집계는 올바른 두 조합만 포함하고 과거/잘못된 설정은 제외한다. byConditions에는 실제 수준을 보존하고 byGeminiModelConditions에서는 모델과 함께 처치인 수준만 제외해 공통조건 아래 두 조합을 나란히 비교한다. 모델만의 인과 효과로 해석하지 않는다.
- 자동 통과 기준: 난수 경계/배정 고정, 직접API·중계·분류·재시도의 수준/한도 동일, 잘못된 설정 거부, 과거 blind-v1 숨김/추측 유지, 추측후 수준공개, 로그 집계의 과거/설정오류 제외 및 같은조건 두 조합 포함. 모의검사·전체Node·타입·Worker빌드·기존 모델 추측 UI/API 흐름으로 확인한다. 실패는 수정후 재실행한다.
- 새 실제 모델 품질 평가/통계적 우열 판정은 이번 변경 범위에서 미실시한다. 운영 소스와 중계 배포후 사용자 새 판으로 품질/지연을 관찰한다.

## 2026-10-07 후보 변경 Flash-Lite HIGH와 Flash MINIMAL

사용자는 인물 의심 질문8조건 결과를 보고 Lite MINIMAL/LOW/MEDIUM은 질문에 구체적으로 답하지 않고 검증하자는 말에 머물러 제외한다고 판단했다. Flash LOW/MEDIUM/HIGH는 응답시간 때문에 제외하고 Lite HIGH와 Flash MINIMAL을 다음 게임 비교 후보로 선택했다. 이는 사용자의 후보 축소 판단이며 모든 입력에 대한 성능 결론이 아니다. 실제 해당 장면의 Flash HIGH12.335초가 LOW16.066초/MEDIUM30.200초보다 빨랐던 사실도 보존한다.

- 새 판: 서버50:50 모델 무작위 배정, Lite HIGH/Flash MINIMAL, 공통8192출력 상한. 기존 JEV 구성·JSON thinking·기억 재입력·블라인드 추측을 유지한다.
- 버전: modelComparisonVersion=gemini-thinking-pair-v3, modelAssignmentVersion=random-blind-thinking-v3, geminiGenerationVersion=thinking-pair-v2.
- 과거 thinking-pair-v1 판은 Lite MEDIUM/Flash MINIMAL을 그대로 검증·전달한다. 과거 random-blind-thinking-v2 판도 추측과 비공개 경계를 유지한다. 과거 판 설정을 HIGH로 바꾸지 않는다. 새 집계에는 올바른v3/v2조합만 포함한다.
- 자동 통과 기준: 새 Lite HIGH/Flash MINIMAL 고정, 직접/중계/분류/재시도/사용량 설정 일치, 잘못된 수준 거부, 이전MEDIUM설정 호환, 이전판 새집계 제외, 이전/새판 추측전숨김 및 추측후실제수준공개.
- 비교표와 선택 근거: `docs/answer-quality-comparison-2026-10-07.md`의 사용자 선택절. 원생성 결과는 Git제외 `logs/evals-thinking-2026-10-07/addressed-question-comparison.json`. 수준당1회, 총8회, 실제JEV선택이유 미기록/사후설명 문제가 남는다.

## Flash-Lite MEDIUM 고정 (2026-10-07)

사용자는 앞선 실제 장면의 비용·지연과 새 판의 대기를 고려해 새 게임 모델을 Flash-Lite MEDIUM으로 고정하도록 결정했다. 새 판은 fixed-lite-medium-v1 생성/배정 버전, 배정 확률1, 출력8192를 사용한다. 무작위 배정·모델 추측은 새 판에서 제거하고 모델은 공개한다. 기존 블라인드 판과 HIGH/MINIMAL·MEDIUM/MINIMAL 생성 설정은 호환 유지한다. modelComparisonVersion=null로 새 고정 판을 과거 모델 쌍 비교에 넣지 않는다.

자동 통과 기준: 고정 Lite MEDIUM의 실제 요청 설정, 잘못된 고정 설정 거부, 과거 블라인드 숨김·HIGH 설정 보존, API NEW에서 클라이언트 모델/추론 덮어쓰기 무시와 저장값 일치. `site/tests/fixed-lite-medium.test.mjs`, `site/tests/api-event-assessment.mjs`로 검사한다. 기존 전체 Node/TypeScript/빌드도 통과해야 한다. 실제 전략/지연 개선은 이 검사만으로 입증하지 않는다.

상황 판단 생성과 대화 모두 고정 설정을 사용한다. 은폐 전략 내용과 호출 시점은 이번 모델 고정에서 바꾸지 않는다. 은폐 전략은 단기 성공 가능성/정체 노출/대체 행동과 악 동료의 실패 담당 조율을 짧게 구조화하는 후속 설계 후보이며 아직 구현하거나 실제 평가하지 않았다.
