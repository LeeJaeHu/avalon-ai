# Avalon

사람 한 명과 AI 네 명이 플레이하는 5인 아발론 웹 게임입니다. 규칙·비밀 정보 경계는 서버에서 판정하며, 모바일 화면에서 팀 제안·투표·임무 카드·암살·채팅을 진행합니다.

- 구현: `site/`
- 제품 요구사항: `docs/avalon-PRD.md`
- AI 행동 설계: `docs/specs/003-avalon-agent-prompts.md`
- 로그·저장 설명: `docs/observability.md`
- 구현·검증 상태: `docs/avalon-implementation-checklist.md`, `작업일지.md`
- 규칙 검사: `cd site && node --test tests/game.test.mjs`
- 로컬 실행: `cd site && npm install && npm run build && npm start` (D1 로컬 마이그레이션 필요)

배포: [Avalon 사이트](https://avalon-ai-game.sooyeon-jun-0389.chatgpt.site) (소유자 전용 비공개). Gemini 비밀값은 Sites 환경 변수에 보관하며 Git에 포함하지 않습니다. 키가 없는 로컬 환경은 화면에 **연습 AI**로 표시되는 규칙 기반 상대가 동작합니다. 모델 대화 자연스러움과 전략 품질은 아직 평가되지 않았습니다.

기존 마피아 구현은 `../solproj/`에 남아 있으며 참고 자료로만 사용합니다. 첨부 룰북 원본은 이 저장소에 복사하지 않았습니다.
