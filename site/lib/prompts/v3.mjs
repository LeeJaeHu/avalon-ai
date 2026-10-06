import {buildPromptV2} from './v2.mjs';
import {TEMPLATE} from './v3-template.mjs';
export {TEMPLATE};
export const PROMPT_VERSION='V3-thinking-memory-v1';
export function buildPromptV3(input){
 return buildPromptV2(input,TEMPLATE).replace('당신에 대한 정보는 다음과 같습니다.','previousThinking은 본인의 직전 판단 기록이며 사실로 확정된 정보가 아닙니다. 새 공개 사실과 대화로 틀린 추측을 수정하세요. 역할·비밀 생각을 공개 text로 옮기지 마세요.\n당신에 대한 정보는 다음과 같습니다.');
}
