import { SarvamAIClient } from 'sarvamai';
import { env } from '../config/env.js';

const client = env.sarvamKey ? new SarvamAIClient({ apiSubscriptionKey: env.sarvamKey, timeoutInSeconds: Math.ceil(env.requestTimeoutMs / 1000), maxRetries: 0 }) : null;
const missing = (value) => (value && String(value).trim()) ? String(value) : 'Not provided';
const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean).map(String) : (value ? [String(value)] : []));

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

export async function generateReport({ state, transcript }) {
  const userTurns = transcript.filter((item) => item.role === 'user');
  const base = {
    status: userTurns.length >= 2 ? 'COMPLETE' : 'INCOMPLETE',
    patientName: missing(state.patientName),
    chiefComplaint: missing(state.chiefComplaint),
    onset: missing(state.onset),
    duration: missing(state.duration),
    severity: missing(state.severity),
    associatedSymptoms: toArray(state.associatedSymptoms),
    summary: userTurns.length ? 'Preliminary intake summary based on the information shared during the call.' : 'Call ended before intake information could be collected.',
    flaggedFollowUp: toArray(state.redFlags).length ? toArray(state.redFlags).join(', ') : 'No red-flag information was provided; a healthcare professional should evaluate the concern.'
  };
  if (!client || !userTurns.length) return base;

  try {
    const result = await client.chat.completions({
      model: env.llmModel,
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Create a factual preliminary health-intake report. Do not diagnose. Never invent missing information. Return JSON with keys: summary (a concise paragraph), flaggedFollowUp (a short string, or the words "None identified" if no red flags).' },
        { role: 'user', content: JSON.stringify({ state, transcript }) }
      ]
    });
    const parsed = parseJsonContent(result.choices[0]?.message?.content) || {};
    return {
      ...base,
      summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : base.summary,
      flaggedFollowUp: typeof parsed.flaggedFollowUp === 'string' && parsed.flaggedFollowUp.trim() && parsed.flaggedFollowUp.trim().toLowerCase() !== 'none' ? parsed.flaggedFollowUp.trim() : base.flaggedFollowUp
    };
  } catch {
    return base;
  }
}
