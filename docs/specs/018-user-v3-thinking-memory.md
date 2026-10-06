# 사용자 V3 프롬프트와 개인 생각 기억

작성일: 2026-10-06. 사용자가 작성한 `site/lib/prompts/v3.txt`를 운영 기본 프롬프트로 사용한다. 과거의 `humanlike-v3` 후보/로컬 실험과 별개다.

- 사용자 본문은 수정하지 않는다. `scripts/sync-player-prompt.mjs`가 v3.txt를 그대로 v3-template.mjs로 생성한다. npm run build에 자동 연결했으며 필수 자리표시자가 없으면 빌드가 실패한다. 모델 프롬프트의 추가 성향·evidence 계약은 기존 방식대로 조립한다.
- V3 프롬프트 버전: V3-thinking-memory-v1. AI 정책: 2026-10-06.9. V1/V2 원문은 보존한다. 진행 중 판의 다음 모델 호출부터 새 버전을 사용하지만 비교할 때는 새 판을 권장한다.
- 공개 채팅은 최신 20개다. 이전 답장 연결 최대 4개와 직접 답할 발언은 별도로 제공한다. JEV의 공개 입력 최근 8개는 변경하지 않는다.
- 개인 정보의 previousThinking은 해당 AI의 가장 최근 채택된 thinking(text·상태 버전·요청 종류·시간)만 포함한다. 이전 생각은 확정 사실이 아닌 본인의 가설로 취급하고 새 공개 사실로 수정하도록 안내한다. 다른 AI의 생각은 포함하지 않는다.
- thinking은 모델 출력 JSON의 자기보고 기록이다. Gemini 네이티브 thought 요약이나 내부 추론 전체를 보관하는 기능으로 표현하지 않는다. 네이티브 thought part는 JSON 파싱에서 제외하며 추론 토큰 수는 기존 사용량 계산에 남긴다.
- 정상적으로 채택·저장한 행동의 생각은 같은 D1 저장에서 게임 privateThinking과 events.detail.thinking에 기록한다. SILENCE의 actor는 system이어도 thinkingOwner는 원래 판단한 AI다. 새 판은 기억이 없는 상태로 시작한다.
- 재시도·폐기 응답 중 정상 JSON에서 받은 생각은 model_usage.detail.thinking에 actor/requestType/source와 함께 보관한다. RESPONDED는 공급자가 응답했다는 뜻이며 행동 채택을 뜻하지 않는다. 기억은 검증 후 정상 저장한 최종 응답으로만 갱신한다. 상태 버전이 변경되면 이전 결과는 저장/기억 갱신하지 않는다. 실패·대체·생각 누락/빈 문자열은 기존 기억을 보존한다. 잘린/잘못된 JSON의 생각은 파싱할 수 없어 내용 미기록이며 기존 오류 코드는 기록한다.
- 공개 관찰·채팅·JEV에는 privateThinking이 전달되지 않는다. 종료 로그에는 game.privateThinking, events[].detail.thinking, modelUsage[].thinking이 포함된다. 종료 후 진단 다운로드의 aiThinking에도 응답 기록이 포함된다. 진행 중 진단에서는 비밀 생각을 노출하지 않는다.
- 출력 768토큰 상한과 Gemini 모델은 유지한다. 추가 요약 모델 호출은 없다. 늘어난 대화·생각 입력과 출력의 비용은 기존 사용량 계측으로 계산한다. 비용/캐릭터 품질 개선은 실제 모델 비교 전 미확인이다.

## 자동 검사와 통과 기준

`cd site; node scripts/sync-player-prompt.mjs; node --test tests/*.test.mjs; node node_modules/typescript/bin/tsc --noEmit`

`tests/player-v3-memory.test.mjs`는 사용자 원문 일치, 20개 경계, 본인 생각 재입력·갱신, 타인/JEV/공개 비노출, 재시도·전체 실패·대체·누락·오래된 버전, 종료 로그, 네이티브 thought/JSON thinking 구분을 검사한다. 기존 규칙·진행·사용량 검사와 함께 모두 통과해야 배포한다. 실패 시 원인을 기록하고 수정 후 관련 검사를 재실행한다.

`docs/review-assets/v3-memory-integration-2026-10-06.json`은 별도 로컬 Worker·D1·모의 Gemini HTTP 공급자에서 두 응답의 기억/로그 연결을 확인한 집계 결과다. 실제 모델 품질 평가가 아니다. 실제 모델 평가는 약속·입장 일관성, 새 반증에 따른 수정, 비밀 노출 및 비용을 같은 상황에서 비교하며 예산·반복 횟수·통과 기준을 별도로 합의한다.
