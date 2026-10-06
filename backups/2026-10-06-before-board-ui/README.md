# 보드 화면 변경 전 백업

2026-10-06 사용자 요청에 따라 보존.

- `local/`: 변경 전 로컬 `site/`의 page.tsx, globals.css, result-popup.mjs.
- `hosted/`: 변경 전 Sites 배포 소스의 같은 파일. 당시 소스 커밋 `d9cec3f5a115b57dea6e5d3884103fd9a0a2a6af`.
- `avalon-board-mock-v1.html`: 이 대화에서 먼저 보여준 보드 화면 예시 원본.
- `hashes.json`: 위 파일의 복사 직후 SHA-256. 기존 로컬/배포 CSS 차이도 별도로 보존했다.

화면을 되돌릴 때 원하는 소스의 `app/page.tsx`, `app/globals.css`, `lib/result-popup.mjs`를 함께 복원하고 관련 테스트/TypeScript/빌드를 확인한다. 이 폴더는 자동 복원 스크립트가 아니며, 이후 다른 변경과의 호환 여부는 복원 시 확인해야 한다. 실제 공개 재배포는 별도 단계다. 비밀 설정·게임 원문 로그는 포함하지 않았다.
