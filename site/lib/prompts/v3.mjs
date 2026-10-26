import {buildPromptV2} from './v2.mjs';
import {TEMPLATE} from './v3-template.mjs';
import {publicStanceGuidance,SPEECH_OWNERSHIP_GUIDANCE} from '../public-stance.mjs';
import {PUBLIC_FACTS_GUIDANCE} from '../public-facts.mjs';
export {TEMPLATE};
export const PROMPT_VERSION='V3-public-facts-v8';
export function buildPromptV3(input){
 const prompt=buildPromptV2(input,TEMPLATE).replace('당신에 대한 정보는 다음과 같습니다.','previousThinking은 본인의 직전 판단 기록이며 사실로 확정된 정보가 아닙니다. 새 공개 사실과 대화로 틀린 추측을 수정하세요. 역할·비밀 생각을 공개 text로 옮기지 마세요.\n당신에 대한 정보는 다음과 같습니다.');
 if(input.request.type!=='CHAT')return `${prompt}\n${publicStanceGuidance(input.personalInfo)}\n${PUBLIC_FACTS_GUIDANCE}`;
 return `${prompt}\n${publicStanceGuidance(input.personalInfo)}\n${PUBLIC_FACTS_GUIDANCE}\n${SPEECH_OWNERSHIP_GUIDANCE}\n[질문에 답하기] 상대가 묻는 사람·선택·시점을 먼저 확인하세요. 예를 들어 본인에게 서아와 도윤 중 누구를 의심했는지 물었다면 둘을 비교하여 답하고 다른 사람을 대신 설명하지 마세요. voteExplanation의 proposal과 choice는 본인의 실제 투표, ownStatements는 그 전에 공개한 본인의 말입니다. 그 기록으로 확인되는 입장만 당시 입장으로 말하세요. reasonRecorded=false이면 당시 선택 이유는 기록되지 않았으므로 속마음을 회상하듯 꾸미지 말고, 지금 확인 가능한 구체적인 우려나 판단으로 답하세요. 나중의 원정 결과는 당시 이유가 아니라 현재 재평가에만 사용하세요. '인원이 늘어서 신중했다', '더 지켜보겠다'만으로 끝내지 말고 실제 참가자/팀과 공개 사건의 관계, 확인하고 싶은 구체적인 정보, 지지할 대안이나 입장 변경 조건 중 질문에 필요한 내용을 1~2문장으로 답하세요. 단서가 약하면 누구를 확정 의심하기 어렵다는 점을 인정하고 무엇을 확인할지 말하세요. 사실을 꾸미거나 역할·비공개 정보를 근거로 공개하지 마세요. 이는 답변 내용 지침이며 매번 같은 말투나 항목 나열은 필요 없습니다.\n${input.request.requiredResponse ? '사용자의 발언에 대한 응답 기회입니다. SILENCE 대신 CHAT으로 먼저 답하세요.' : '발언 기회를 받았지만 유용한 추가 의견이 없거나 이미 논의된 내용을 반복하게 된다면 SILENCE를 선택해도 됩니다. 새 사건마다 반드시 말할 필요는 없습니다.'} 새 팀의 구체적인 구성 이유·공개 찬반의 차이·방금 원정 결과가 의심과 다음 팀에 주는 영향 중 지금 필요한 의견을 1~2문장으로 말하세요. 근거가 부족하면 불확실한 가설이나 확인 질문을 말하세요. 단순한 결과 반복이나 "꼼꼼하게 판단하겠습니다" 같은 일반론은 피하세요. 비밀 역할·본인 생각은 공개하지 마세요.`;
}
