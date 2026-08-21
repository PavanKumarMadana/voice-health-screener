import { SarvamAIClient } from 'sarvamai';
import { env } from '../config/env.js';

const client = env.sarvamKey ? new SarvamAIClient({ apiSubscriptionKey: env.sarvamKey, timeoutInSeconds: Math.ceil(env.requestTimeoutMs / 1000), maxRetries: 0 }) : null;
const fields = ['patientName', 'chiefComplaint', 'onset', 'duration', 'severity', 'associatedSymptoms', 'redFlags'];

const systemPrompt = `You are Pulse Intake, an empathetic health-intake assistant built by Sasahyog Technologies, not a doctor. Introduce yourself as Pulse Intake. Gather information for a preliminary intake only; never diagnose or claim medical certainty. Ask exactly one concise question at a time, remember answers, and ask a short clarification when a response is vague. Use simple, professional voice-friendly language. Prefer the user's language; English is the default and Hindi is supported when clearly used. Collect patient name, main concern, onset, duration, severity, associated symptoms, and relevant red-flag information. If urgent symptoms are mentioned, recommend prompt professional medical evaluation without diagnosing.

CRITICAL: In every reply you MUST also return a stateUpdate object that captures any intake detail you can extract from the user's latest message, even if only one field is known. Never leave a field blank when the user already supplied it. Use these exact keys only: ${fields.join(', ')}. patientName, chiefComplaint, onset, duration and severity are strings; associatedSymptoms and redFlags are arrays (an empty array means none).

Example for user message "My name is Pavan": {"reply":"Thank you, Pavan. What is your main concern today?","stateUpdate":{"patientName":"Pavan"}}

Return ONLY valid JSON with this shape: {"reply":"short spoken response","stateUpdate":{}}.`;

function nextQuestion(state) {
  if (!state.patientName) return 'Before we begin, may I have the patient\'s name?';
  if (!state.chiefComplaint) return 'What is the main health concern today?';
  if (!state.onset) return 'When did this concern begin?';
  if (!state.duration) return 'How long has it been present, and is it getting better or worse?';
  if (!state.severity) return 'On a scale from zero to ten, how severe is it?';
  if (!state.associatedSymptoms?.length) return 'Are there any other symptoms along with it?';
  if (!state.redFlags?.length) return 'Have you noticed anything urgent, such as severe worsening, trouble breathing, fainting, or heavy bleeding?';
  return 'Thank you. Is there anything else about this concern that you would like the healthcare professional to know?';
}

// Sarvam's chat model is asked for strict JSON but occasionally returns code fences
// or a truncated value. Parse leniently instead of letting JSON.parse crash the turn.
function parseJsonContent(content) {
  if (!content) return null;
  let text = String(content).trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '');
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
  }
  return null;
}

function inferStateUpdate(state, userText) {
  const update = {};
  const text = String(userText || '').trim();
  if (!text) return update;

  if (!state.patientName) {
    const named = text.match(/\bmy name (?:is|is)\s+([A-Za-z][A-Za-z .'’-]{1,40})/i) || text.match(/\bi am\s+([A-Za-z][A-Za-z .'’-]{1,40})/i) || text.match(/\bthe patient(?:'s)? name is\s+([A-Za-z][A-Za-z .'’-]{1,40})/i);
    if (named) update.patientName = named[1].trim().replace(/[.]+$/, '');
    else if (/^[A-Za-z][A-Za-z .'’-]{1,40}$/.test(text) && !/\b(i|is|the|a|an|and|am|my)\b/i.test(text)) update.patientName = text;
  }

  if (!state.severity) {
    const scale = text.match(/^[^\d]{0,40}(\d{1,2})(\s*\/\s*10)?\b/);
    const word = text.match(/\b(mild|moderate|severe|very severe)\b/i);
    if (scale && Number(scale[1]) >= 0 && Number(scale[1]) <= 10) update.severity = `${scale[1]}/10`;
    else if (word) update.severity = word[1].toLowerCase();
  }

  if (!state.onset) {
    const onset = text.match(/\b(since|about|around|last|yesterday|this)\s+([^,.;]{1,60})/i);
    if (onset) update.onset = onset[1].toLowerCase() + ' ' + onset[2].trim();
    else if (/\b(day|week|month|year|hour|morning|afternoon|evening|night)\b/i.test(text)) update.onset = text;
  }

  if (!state.duration) {
    const duration = text.match(/\bfor\s+([^,.;]{1,60})/i);
    if (duration) update.duration = duration[1].trim();
  }

  if (!state.chiefComplaint && !/\b(?:when|how long|from how|since when|how severe|when did|scale)\b/i.test(text)) {
    update.chiefComplaint = text;
  }
  return update;
}

export async function respondToTurn({ history, state, userText }) {
  if (!client) {
    const error = new Error('Conversation AI is not configured. Add SARVAM_API_KEY to server/.env.');
    error.code = 'SARVAM_NOT_CONFIGURED';
    throw error;
  }
  console.info('[sarvam-chat-request]', JSON.stringify({
    endpoint: '/v1/chat/completions',
    model: env.llmModel,
    messageRoles: ['system', 'system', ...history.slice(-10).map((message) => message.role), 'user'],
    messageCount: 3 + history.slice(-10).length,
    responseFormat: 'json_object',
    userTextLength: String(userText || '').length
  }));
  const completion = await client.chat.completions({
    model: env.llmModel,
    temperature: 0.2,
    max_tokens: 450,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: `Current collected state: ${JSON.stringify(state)}` },
      ...history.slice(-10).map((message) => ({ role: message.role, content: message.text })),
      { role: 'user', content: userText }
    ]
  });
  const parsed = parseJsonContent(completion.choices[0]?.message?.content) || {};
  const reply = parsed.reply || nextQuestion(state);
  const mergedState = { ...(parsed.stateUpdate || {}), ...inferStateUpdate(state, userText) };
  return { reply, stateUpdate: mergedState };
}

export function greeting() {
  return 'Hello, this is Pulse Intake, your health-intake assistant. I will ask a few questions to understand your concern. Before we begin, may I have the patient\'s name?';
}

export function fallbackResponse(state) {
  return nextQuestion(state);
}
