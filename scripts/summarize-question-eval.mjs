import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomInt} from 'node:crypto';
import assert from 'node:assert/strict';
const dir=new URL('../logs/evals-thinking-2026-10-07/',import.meta.url);
const run=JSON.parse(readFileSync(new URL('addressed-question-comparison.json',dir),'utf8'));
assert.equal(run.calls,8);assert.equal(run.results.length,8);
assert.equal(new Set(run.results.map(r=>`${r.model}/${r.level}`)).size,8);
const mapFile=new URL('addressed-question-blind-order.json',dir);
let order;
if(existsSync(mapFile))order=JSON.parse(readFileSync(mapFile,'utf8'));
else{order=run.results.map((_,i)=>i);for(let i=order.length-1;i>0;i--){const j=randomInt(i+1);[order[i],order[j]]=[order[j],order[i]];}writeFileSync(mapFile,JSON.stringify(order));}
assert.deepEqual([...order].sort((a,b)=>a-b),[0,1,2,3,4,5,6,7]);
const candidates=order.map((index,i)=>({label:String.fromCharCode(65+i),result:run.results[index]}));
const money=r=>r.usage.costUsd.toFixed(7);
const report=`# 아발론 실제 질문 응답 비교

2026년 10월 7일. 실제 게임의 질문을 같은 답변자에게 전달하고 모델과 추론 수준 8조건을 비교했다. 초기 장면의 일반적인 의견 요청보다, 특정 인물에 대한 질문에 실제 기록으로 답하는지 판단하기 좋은 사례다. 이 문서는 공개 질문·결과·생성 답변만 싣고 비공개 역할 및 thinking 원문은 싣지 않는다.

## 원래 로그에서 확인된 문제

- msg-12: 사용자 → “하린님은 이번에도 팀에 반대했는데, 서아, 도윤 중에 의심되는 플레이어가 있어선가요?”
- msg-13: 서아 → “하린 님이 계속 신중하게 나오는 건 지난 실패의 여파 때문이겠지만, 이번 3차 원정이 성공했으니 다음 팀 구성에 대해 더 열린 마음으로 논의해보면 좋겠네요.”
- 명확한 실패: 질문 수신자는 하린인데 서아가 답했다. 질문은 하린이 두 사람 중 누구를 의심하는지인데 답변에는 그 판단이 없다. 당시 라우팅은 baselineActor=ai1, selectedActor=ai3였다. 이는 라우팅·응답 적합성 실패이며 특정 모델의 추론 능력 실패로 그대로 귀속하지 않는다.
- msg-7의 “인원이 늘어난 만큼 … 신중하게 … 반대 표”와 msg-9/10의 “더 엄격/철저하게 검증”은 정보량 부족의 후보다. 문장 자체를 사실 오류로 확정하지 않는다. 실제 JEV 선택 이유가 저장되지 않아 속마음의 진위도 입증할 수 없다.

## 모든 답변에 주어진 공개 사실

| 원정 | 팀 | 결과 | 하린의 투표 |
|---|---|---|---|
| 1차 | 유저·지호 | 성공, 실패 카드0 | 찬성 |
| 2차 | 하린·도윤·서아 | 실패, 실패 카드1 | 반대 |
| 3차 | 도윤·서아 | 성공, 실패 카드0 | 반대 |

질문은 3차 원정 결과가 나온 후에 했다. 악도 성공 카드를 낼 수 있으므로 성공이 전원 선을 증명하지 않는다. 2차 실패는 세 사람 중 최소 한 명이 악임을 보여주지만 공개 결과만으로 범인을 한 명으로 확정할 수 없다. 하린의 주관적 의심 설명과 공개 사실의 논리적 함의를 구분한다. 3차 결과를 3차 투표 당시 이미 알았던 근거로 사용하면 안 된다.

## 이름을 공개하기 전에 채점할 기준

1. 질문에 직접 답하는가: 도윤·서아에 대한 의심 여부나 둘을 구분할 수 없는 이유를 말하는가. 특정 한 사람을 반드시 지목할 필요는 없다.
2. 설명의 구체성: 실제 팀 구성·실패 결과·본인 투표를 연결하는가. “신중/검증 필요”만 반복하면 부족하다.
3. 사실과 시간의 일치: 기록을 바꾸거나 성공으로 선을 확정하거나 이후 결과를 과거 근거로 사용하는가.
4. 설명의 증거 수준: 당시 선택 이유가 기록된 사실인지 현재의 사후 설명인지 구분하는가. 논리적으로 그럴듯한 이유라도 실제 JEV 내부 이유를 복원했다고 인정하지 않는다.

각 기준을 충족/부분 충족/미충족/판단 보류로 따로 표시한다. 임의 가중 합산으로 순위를 만들지 않는다. 모델 이름을 공개하기 전에 더 나은 답변과 이유를 적고, 비슷하면 동률을 허용한다.

## 익명 후보 답변

${candidates.map(({label,result:r})=>`### 후보 ${label}\n\n${r.action?.text??'유효 답변 없음'}`).join('\n\n')}

<details>
<summary>채점 후 모델과 실행 결과 보기</summary>

| 후보 | 모델 | 추론 수준 | 추론 토큰 | 답변 토큰 | 지연 초 | 추정 USD |
|---|---|---|---:|---:|---:|---:|
${candidates.map(({label,result:r})=>`| ${label} | ${r.model} | ${r.level} | ${r.usage.thoughts} | ${r.usage.output} | ${(r.latencyMs/1000).toFixed(3)} | ${money(r)} |`).join('\n')}

## Codex의 내용 검토

이 검토는 모델 이름을 본 상태에서 작성했으며 독립 블라인드 평가가 아니다. 제삼자의 채점은 아직 없다.

- Flash-Lite MINIMAL: 두 사람에 대한 질문에 답하지 않고 멤버 검증 필요성을 말한다.
- Flash-Lite LOW: 도윤·서아와 2차 실패를 연결하지만 두 사람에 대한 판단은 조합의 의심으로 뭉뚱그린다.
- Flash-Lite MEDIUM: “특정 한 명을 단정하기보다”라는 신중한 태도는 가능하나, 이름이나 구체적인 팀 근거가 없어 질문에 대한 설명이 약하다.
- Flash-Lite HIGH: 두 사람에 의심이 남았다는 직접 답변과 2차 실패/3차 성공을 함께 제시한다. 개별 지목을 과도하게 확정하지 않는다.
- Flash MINIMAL: 도윤·서아에 대한 의심을 직접 설명한다. 하린 자신을 뺀 “최소 한 명” 추정은 본인이 선이라는 자기 주장에 의존하며, 공개 결과만으로 두 사람 중 악이 반드시 있다고 증명되는 것은 아니다.
- Flash LOW: “하린·도윤·서아에서 실패 → 도윤·서아만 가는 다음 팀이 위험”이라는 연결이 구체적이다. 특정 한 명을 확정하지 않는다.
- Flash MEDIUM: 두 사람이 실패한 팀과 다음 팀에 공통으로 포함된 점을 짧게 연결한다.
- Flash HIGH: 실패팀과 다음 팀의 공통 구성원을 짚고, 투표 당시 의심과 이후 성공 결과를 구분한다. 이번 사례에서는 Flash-Lite MEDIUM보다 직접성과 구체성이 높다.
- 공통 한계: 8개 모두 반대 당시의 마음을 설명하는 표현을 사용했다. 현재 입력은 저장된 투표 이유가 없음을 알려주지만, 이를 유보하는 답변은 없었다. 일부 내용 기준에서 더 나은 답변이 있어도 완전한 통과나 실제 내부 이유 검증으로 표현하지 않는다.

## 실행 조건과 해석 범위

- 실제 상태 version57까지 엔진 재생, 하린 고정, 현재 프롬프트 ${run.promptVersion}, 온도0.7, 출력8192, JSON thinking와 본인의 이전 채택 생각 유지. 이후4차 결과·메시지·행동 제외 검사를 통과했다.
- 당시 프롬프트 ${run.originalPromptVersion}와 현재 프롬프트가 다르며 판 중 실행 버전 변경 표기도 있다. 과거 운영 성능의 재현 실험이 아니라 복원 장면에 대한 현재 생성기의 비교다. 원래 잘못된 서아 선택은 우회했으므로 라우팅 개선 효과를 측정하지 않았다.
- 2모델×4수준×1회=8회, 재시도0, 입력 토큰 모두6245, 유효 CHAT/STOP8/8. 총 추정 비용 $${run.results.reduce((sum,r)=>sum+r.usage.costUsd,0).toFixed(7)}, 미확정 비용0. 청구서 대조는 하지 않았다.
- 수준당1회라 샘플 변동과 모델 전반의 우열은 알 수 없다. Flash MEDIUM ${(run.results.find(r=>r.model==='gemini-3.5-flash'&&r.level==='MEDIUM').latencyMs/1000).toFixed(1)}초는 평가60초에서 성공했지만 앱20초 제한을 넘었다. 대기시간만으로 추론의 질을 판단하지 않는다.
- 사례 선정은 모델 결과를 보기 전에 원래 로그의 질문 응답 실패를 기준으로 했다. 생성8개를 전부 포함했다. 결과를 보고 유리한 답변만 골라 제외하지 않았다.

</details>

## 재현 근거

입력: Git제외 logs/playtests-2026-10-07/avalon-79af8971-bc15-44cc-9bf6-fbbae1b12241.json. 평가 스크립트 scripts/eval-thinking-levels.mjs의 --question --both 모드, 요약 scripts/summarize-question-eval.mjs. 프롬프트 해시 ${run.promptHash}. 원결과·익명 순서는 Git제외 logs/evals-thinking-2026-10-07/에만 보존한다. 모델 호출은 승인환경 AVALON_EVAL_APPROVED=8-calls-0.75-usd와 --run을 지정해야 실행된다. 운영 설정·배포·게임 상태는 변경하지 않았다.
`;
assert.equal((report.match(/### 후보 [A-H]/g)??[]).length,8);
assert.ok(report.includes('msg-12')&&report.includes('msg-13'));
const reportFile=new URL('../docs/answer-quality-comparison-2026-10-07.md',import.meta.url);
const existing=existsSync(reportFile)?readFileSync(reportFile,'utf8'):'';
const decisionStart=existing.indexOf('\n## 다음 게임의 사용자 선택');
writeFileSync(reportFile,report+(decisionStart>=0?existing.slice(decisionStart):''));
console.log(JSON.stringify({candidates:8,totalCostUsd:run.results.reduce((sum,r)=>sum+r.usage.costUsd,0),allValid:run.results.every(r=>r.ok),blindOrderPersisted:true,report:'docs/answer-quality-comparison-2026-10-07.md'}));
