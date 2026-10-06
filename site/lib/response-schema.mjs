import { IDS, SPEECH_ACTS } from './game.mjs';
import { evidenceReferenceIds } from './evidence.mjs';

export function responseSchema(request, view, referenceIds = evidenceReferenceIds(view, view)) {
  const fields = {
    type: { type: 'STRING', enum: request.type === 'CHAT' ? ['CHAT', 'SILENCE'] : [request.type] },
    thinking: { type: 'STRING' },
    evidence: { type: 'OBJECT', properties: {
      summary: { type: 'STRING', description: '선택에 대한 1~2문장, 240자 이하의 짧은 설명. 상세 추론은 제외.' },
      references: { type: 'ARRAY', items: { type: 'STRING', enum: referenceIds }, minItems: 0, maxItems: 4 },
      confidence: { type: 'STRING', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    }, required: ['summary', 'references', 'confidence'] },
  };
  if (request.type === 'CHAT') {
    fields.text = { type: 'STRING' };
    fields.speechAct = { type: 'STRING', enum: SPEECH_ACTS };
  }
  if (request.type === 'PROPOSE') fields.team = { type: 'ARRAY', items: { type: 'STRING', enum: IDS }, minItems: view.size, maxItems: view.size };
  if (request.type === 'VOTE') fields.choice = { type: 'STRING', enum: ['APPROVE', 'REJECT'] };
  if (request.type === 'CARD') fields.choice = { type: 'STRING', enum: ['MERLIN', 'LOYAL'].includes(view.role) ? ['SUCCESS'] : ['SUCCESS', 'FAIL'] };
  if (request.type === 'ASSASSINATE') fields.target = { type: 'STRING', enum: IDS.filter(id => id !== request.actor) };
  return { type: 'OBJECT', properties: fields, required: request.type === 'CHAT' ? ['type', 'evidence'] : ['type', ...Object.keys(fields).filter(key => !['type', 'thinking'].includes(key))] };
}
