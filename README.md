# AI와 함께하는 레지스탕스: 아발론

사람 1명과 AI 4명이 플레이하는 5인 기본판을 계획 중인 **독립 프로젝트**입니다. 현재는 설계와 합성 모델 탐색만 있으며 게임 코드는 아직 없습니다.

- [PRD](docs/avalon-PRD.md): 게임 범위와 완료 기준
- [AI 행동 프롬프트 Spec](docs/specs/003-avalon-agent-prompts.md): 역할·성격·행동 계약과 정보 경계
- [구현 체크리스트](docs/avalon-implementation-checklist.md): 단계별 작업과 검증
- [임무 카드 탐색 기록](playtests/avalon-quest-card-probe-2026-09-29.md): 합성 상황의 단발 모델 호출
- [작업일지](작업일지.md): 이전 아발론 기록과 이후 진행 사항

기존 마피아 구현은 `../solproj/`에 남아 있으며 참고 자료로만 사용합니다. 아발론의 코드·게임 상태·배포는 이 폴더에서 별도로 관리합니다. 첨부 룰북 원본은 사용자의 `Downloads` 폴더에 있고 이 프로젝트에는 복사하지 않았습니다.
# Avalon

사람 한 명과 AI 네 명이 플레이하는 5인 아발론 웹 게임입니다. 규칙·비밀 정보 경계는 서버에서 판정하며, 모바일 화면에서 팀 제안·투표·임무 카드·암살·채팅을 진행합니다.

- 구현: `site/`
- 제품 요구사항: `docs/avalon-PRD.md`
- 로그·저장 설명: `docs/observability.md`
- 규칙 검사: `cd site && node --test tests/game.test.mjs`
- 로컬 실행: `cd site && npm install && npm run build && npm start` (D1 로컬 마이그레이션 필요)

Gemini API 키가 설정되지 않으면 화면에 **연습 AI**로 표시되는 규칙 기반 상대가 동작합니다. 모델 대화와 전략 품질은 키 설정 및 실제 플레이 검증 전까지 미확인입니다.
