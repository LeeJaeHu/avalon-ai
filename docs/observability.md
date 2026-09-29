# 게임 기록과 운영 관측

## 실제 저장 구조

게임은 Sites D1의 `games` 테이블에 상태 JSON으로 저장된다. 게임 ID는 브라우저의 HttpOnly 쿠키에 보관한다. 채팅 원문은 대화 재표시와 AI 문맥을 위해 게임 상태에 포함된다. 역할, 비밀 투표, 임무 카드는 서버 상태에만 있으며 `observe()`가 본인에게 허용된 정보만 응답한다.

`events` 테이블은 서버가 **수락한 의미 있는 행동**을 게임 ID·상태 버전·행동 주체·종류·시각으로 기록한다. 현재 종류는 `GAME_CREATED`, `CHAT`, `PROPOSE`, `VOTE`, `CARD`, `ASSASSINATE`다. 채팅 이벤트에는 글자 수만, 모델 이벤트에는 모델 모드·토큰 수·지연 시간만 기록한다. 원문, 역할표, 비밀 카드, API 키는 이벤트 상세에 넣지 않는다. 화면의 모든 탭·스크롤 같은 클릭은 게임 분석에 필요하지 않아 수집하지 않는다. 전송 실패나 아직 제출하지 않은 선택은 기록되지 않는다.

## trace · log · metric

- Trace 연결: `game_id → version → actor/type`. `events`의 연속 버전으로 상태 전이를 따라간다. 별도 분산 추적 시스템은 아직 없다.
- Log: API 읽기/행동 실패는 서버 `console.error`에 사건명과 오류만 남긴다. 사용자 채팅 원문은 출력하지 않는다.
- Metric: `events`를 종류별로 집계해 투표·임무·채팅 횟수와 판 완주를 계산한다. 모델 호출 토큰·지연은 AI 행동 이벤트에서 합산할 수 있다. 대시보드와 알림은 아직 없다.

예시 쿼리:

```sql
SELECT type, COUNT(*) AS count FROM events GROUP BY type;
SELECT game_id, MAX(version) AS last_version,
       SUM(type = 'CHAT') AS chats,
       SUM(type = 'VOTE') AS votes
FROM events GROUP BY game_id;
```

## 개인정보와 운영 한계

새 사이트는 소유자 전용 비공개 접근이다. GitHub 저장소에도 실제 게임 데이터는 올리지 않는다. 개인 이름이나 민감한 내용을 채팅에 입력하지 않는 것이 좋다. 현재 자동 보관 기한·삭제 UI·동의 화면·외부 분석 도구는 없다. 다른 이용자에게 사이트를 공유하기 전에 사용자 식별·삭제 요청·보관 기한을 구현해야 한다. 원문을 포트폴리오 사례에 옮길 때는 이용 권한과 개인정보를 별도로 확인한다.
