# 033 공개 파생 사실(public facts)

## 문제
2026-10-26 판 `bf889a72`(사람 충신, Flash-Lite MEDIUM, JEV 행동·player 발언 판단)에서 AI가 공개 기록을 잘못 읽거나 활용하지 못했다.

- 암살자 하린이 2인 원정(유저·하린)에서 실패 카드를 내 사람에게 바로 확정 노출됐다.
- 하수인 도윤이 1원정 실패팀과 같은 팀(유저·하린)을 3원정에 제안하고 "다른 조합"이라고 설명했다.
- 멀린 지호는 정보가 없는 1원정 투표에서 혼자 반대했는데, 암살자는 사람(충신)을 지목했다.

행동 입력에는 원정·투표 원자료만 있었다. 동일 팀 여부, 확정 노출, 멀린 신호는 모델이 직접 계산해야 했다.

## 설계
`site/lib/public-facts.mjs`의 `publicFacts(view, actor)`가 서버에서 계산한다.

| 구역 | 내용 | 누구에게 |
| --- | --- | --- |
| `public.currentTeam` | 현재 팀이 실패/성공 원정팀과 같은지, 실패 원정 참가자 포함 여부 | 모두 |
| `public.playerRecords` | 플레이어별 실패·성공 원정 참가 | 모두 |
| `public.voteSignals` | 나중에 실패한 팀에 반대한 횟수, 그중 공개 근거 없는 반대(`unexplainedCorrectRejects`) | 모두 |
| `self.certainEvil/certainGood` | 본인이 선이라는 가정에서 원정 결과로 확정되는 악·선 | 충신 |
| `self.exposedTo` | 공개 기록만으로 본인을 확정 악으로 아는 사람 | 악 |
| `self.cardIfFail` | 이번에 실패를 내면 새로 확정 노출되는 사람, 같은 팀의 악 동료 | 원정 중인 악 |
| `self.merlinVoteSignals` | 각 후보의 표가 실제 악 포함 여부와 맞은 횟수와 공개 근거 없는 정확한 반대 | 암살자 |
| `self.ownMerlinSignal` | 본인 표가 악에게 멀린처럼 보이는 정도 | 멀린 |

"공개 근거 있음"은 팀원 중 이전 실패 원정 참가자가 있는 경우로 정의한다. 단순 규칙이다. 실패 원정 참가 여부 외의 대화 근거는 반영하지 않는다.

연결 위치는 다음과 같다.
- JEV 행동: `state.public.publicFacts`, `state.self.publicFacts`, 지침 `PUBLIC_FACTS_GUIDANCE`. PROPOSE 후보 설명에 `[1원정 실패팀과 동일]` 같은 주석, VOTE 후보에 현재 팀 주석을 붙인다.
- Gemini 상황 판단과 JEV 발언 의사: 행동 입력의 state를 재사용하고 같은 지침을 추가한다. 발언 의사에는 "공개 사실과 어긋나는 해명만 가능하면 WAIT"를 추가한다.
- Gemini 채팅: `personalInfo.publicFacts`와 지침을 추가한다.

결정적인 계산만 추가했다. 전략을 강제하는 규칙(예: 2인 원정에서 실패 금지)은 넣지 않았다. 선택은 계속 모델이 한다.

버전은 다음과 같다. 정책 `2026-10-26.22-public-facts`, 행동 `jev-player-choice-v6-public-facts`, 판단 `event-assessment-leader-before-team-v6-public-facts`, 발언 의사 `player-discussion-intent-v3-public-facts`, 채팅 `V3-public-facts-v8`, 사실 `public-facts-v1`.

## 검증
자동 검사: `site/tests/public-facts.test.mjs`(bf889a72의 원정·투표 기록을 채팅 없이 재현)
1. 실패팀과 같은 팀은 순서와 무관하게 `identicalToFailedQuests`와 PROPOSE·VOTE 후보 설명에 표시된다.
2. 2인 원정 카드 단계의 암살자에게 `cardIfFail.newlyCertainTo=['human']`, 1원정 실패 후 `exposedTo=['human']`.
3. 충신 관점의 확정 악은 원정 결과로 논리적으로 확정될 때만 나온다(1원정에 없던 서아는 미확정).
4. 지호의 1원정 반대는 공개 근거 없는 정확한 반대 1회, 유저의 2원정 반대는 공개 근거 있음.
5. 비밀 경계: 숨은 역할을 바꿔도 public 구역과 충신의 self 구역은 같다. 충신 self에는 확정 계산 외 항목이 없다. 하수인에게는 암살자용 신호가 없다.
6. 행동·상황 판단·발언 의사·채팅 입력에 사실과 지침이 들어간다(모의 모델).

실제 모델 평가: 미실시. 규칙 테스트 통과는 모델이 사실을 더 잘 쓰게 됐다는 증거가 아니다. 제안 평가는 같은 장면을 변경 전후 입력으로 반복 호출해 선택을 비교하는 것이다. 장면은 1원정 카드(암살자), 3원정 제안(하수인), 암살, 실패 인원 지적에 대한 채팅 답변이다. 비용·반복 수는 사용자 승인 후 정한다.

## 남은 위험
- 입력 길이 증가에 따른 지연·비용 변화는 미측정이다.
- 7인 확장 시 악 3명·4원정 실패 2장 규칙에서도 계산은 일반식이다. 다만 테스트는 5인만 있다.
- 공개 근거의 정의가 단순해 대화로 생긴 의심은 "근거 없음"으로 집계될 수 있다.
