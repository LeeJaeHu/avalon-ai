# 개인 Cloudflare 배포 운영

## 구성
- 소스: `site/`, 별도 설정 `site/vite.cloudflare.config.ts`, `site/wrangler.cloudflare.jsonc`.
- `site/wrangler.cloudflare.jsonc`는 계정 ID·D1 ID가 들어 있어 Git에서 제외한다. 새로 받은 저장소에서는 `site/wrangler.cloudflare.example.jsonc`를 이 이름으로 복사하고 자리표시자를 실제 값으로 바꾼다.
- Worker: `avalon-private`, 새 DB: `avalon-private-db`.
- 주소: https://avalon-private.skbm653.workers.dev
- 이 주소의 인증/플레이 검증 완료 여부는 최상위 작업일지 참고. 주소 생성만으로 이전 완료를 뜻하지 않는다.
- 기존 Sites 빌드 명령과 서비스는 보존한다. 독립 빌드는 `dist/`를 덮어쓰므로 아래 빌드·배포 명령을 묶어서 사용한다.

## 배포
Node.js 22.13 이상에서 저장소의 `site` 폴더로 이동한다.

```powershell
npm ci
npx wrangler login --scopes account:read user:read workers:write workers_scripts:write workers_routes:write d1:write
npm run deploy:cloudflare
```

Wrangler의 불필요한 기본 권한 누락 경고는 전체 권한을 추가해야 한다는 뜻이 아니다. 실제 요청이 필요한 권한으로 성공하는지 확인한다.

DB 스키마가 추가될 때만 적용한다. 기존 Sites DB나 로컬 DB에 적용하지 않는다.

```powershell
npx wrangler d1 migrations apply DB --remote --config wrangler.cloudflare.jsonc
```

## 비밀 설정과 인증
Worker secrets: `OWNER_EMAIL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `VERTEX_PROXY_URL`, `VERTEX_PROXY_TOKEN`, `TYPESAFE_API_KEY`, `LOG_SYNC_TOKEN`.
Cloudflare Access에서 Worker의 전체 운영 트래픽을 보호하고 본인 이메일만 허용한다. 도메인 전체 허용이나 Everyone 정책을 사용하지 않는다. Preview URL은 코드 설정에서 비활성화한다.
인증 설정이 빠지면 모든 요청은 503, 유효한 본인 Access JWT가 없으면 403이다. 정적 파일도 같은 인증을 통과해야 한다. 키 값은 문서·Git·명령 인자에 쓰지 말고 대시보드 Secrets나 Wrangler의 표준 입력으로 등록한다.
Access 정책이나 인증 비밀 설정은 이전 Worker 버전으로 되돌린다고 함께 복구된다고 가정하지 않는다.

## 검증
저장소 최상위에서:

```powershell
node --test site/tests/*.test.mjs scripts/*.test.mjs
node site/node_modules/typescript/bin/tsc -p site/tsconfig.json --noEmit --incremental false
```

배포 후 로그인하지 않은 새 세션에서 `/`, `/api/game`, `/api/logs`, `/favicon.svg` 접근이 차단되는지 확인한다. 로그인 후에는 새 게임, 새로고침, AI 응답, JSON 다운로드를 확인한다. 실제 모델 호출에는 별도 API 비용이 들며 자동 규칙 테스트와 다른 검증이다.

## 기록·백업·복구
게임 원본은 D1의 `games`, `events`, `model_usage`, `ai_failures`다. AI 요청 잠금은 `ai_locks`에 저장한다. 게임 종료 후 JSON 다운로드는 브라우저에서 PC로 받는다. Workers 실행 로그는 오류 진단용이며 게임 원본의 대체 저장소가 아니다.
PC 동기화는 별도 Access 인증 연결 전까지 기존 사이트 설정으로 남아 있다. 새 사이트의 자동 PC 백업이 동작한다고 가정하지 않는다.

```powershell
# site 폴더에서 실행. 출력 파일은 Git에서 제외된 폴더에 보관한다.
npx wrangler d1 export DB --remote --config wrangler.cloudflare.jsonc --output .sites-runtime/avalon-private-backup.sql
```

DB 백업에는 역할·대화·모델 기록이 포함되므로 공개 저장소에 올리지 않는다. 코드 장애는 Cloudflare 대시보드의 배포 버전에서 확인한 이전 정상 버전으로 롤백한다. DB 변경은 코드 롤백과 별개이므로 백업과 스키마 호환성을 확인한다.

## 2026-10-08 실제 확인 상태
- Zero Trust Free, Worker 전체 트래픽 정책 `Avalon owner only`: Cloudflare 계정 멤버 AND 소유자 이메일. 로그인은 게임 주소에서 Cloudflare를 선택한다.
- 비로그인 GET/POST 8개 경로 차단, 본인 로그인·UI·신규 게임·D1 저장·새로고침 복원 확인. 자동 규칙/보안 검사167개 통과.
- 새 게임1회와 ADVANCE 총4회(사용자 추가 승인 포함)로 JEV 팀 선택과 Gemini 상황 판단의 실제 응답 성공 확인. 검증 게임은 일시정지 상태다. 완주·최종 JSON 다운로드·전략 품질은 이번 제한 검증에서 미실시.
- 모델 응답의 기록된 사용량 비용 합계는 약 USD0.001323. 첫 Cloud Run 실패 호출은 사용량 미확인으로 별도 표시하며 실제 청구액과 동일하다고 보장하지 않는다.
- 기존 Google 중계에서 인스턴스 없음/HTTP500이 발생했다. 동일 이미지·설정의 `avalon-vertex-proxy-recovery1008` 재배포로 복구하고 실제 Gemini 호출을 확인했다. 근본 원인은 미확인이다. 재발 시 Cloud Logging의 해당 서비스 요청/시스템 로그 및 Ready·결제 상태를 확인한다. `/` GET은 정상 시404이고 모델을 호출하지 않는다. 무조건 최소 인스턴스를 늘리거나 모델 호출을 반복하지 않는다.
- 이 배포는 사용자 Cloudflare 계정과 기존 Google/JEV 서비스로 실행된다. 서비스 계정·요금제·API 키 유지가 필요하며 Codex에서 서버를 실행해 둘 필요는 없다.
