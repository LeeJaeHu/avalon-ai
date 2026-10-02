import { IDS, SPEECH_ACTS } from './game.mjs';

export function responseSchema(request, view) {
  const fields = {
    type: { type: 'STRING', enum: request.type === 'CHAT' ? ['CHAT', 'SILENCE'] : [request.type] },
    thinking: { type: 'STRING' },
  };
  if (request.type === 'CHAT') {
    fields.text = { type: 'STRING' };
    fields.speechAct = { type: 'STRING', enum: SPEECH_ACTS };
  }
  if (request.type === 'PROPOSE') fields.team = { type: 'ARRAY', items: { type: 'STRING', enum: IDS }, minItems: view.size, maxItems: view.size };
  if (request.type === 'VOTE') fields.choice = { type: 'STRING', enum: ['APPROVE', 'REJECT'] };
  if (request.type === 'CARD') fields.choice = { type: 'STRING', enum: ['MERLIN', 'LOYAL'].includes(view.role) ? ['SUCCESS'] : ['SUCCESS', 'FAIL'] };
  if (request.type === 'ASSASSINATE') fields.target = { type: 'STRING', enum: IDS.filter(id => id !== request.actor) };
  return { type: 'OBJECT', properties: fields, required: request.type === 'CHAT' ? ['type'] : ['type', ...Object.keys(fields).filter(key => !['type', 'thinking'].includes(key))] };
}
