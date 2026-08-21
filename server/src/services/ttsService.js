import { SarvamAIClient } from 'sarvamai';
import { env } from '../config/env.js';

const client = env.sarvamKey ? new SarvamAIClient({ apiSubscriptionKey: env.sarvamKey, timeoutInSeconds: Math.ceil(env.requestTimeoutMs / 1000), maxRetries: 0 }) : null;

export async function synthesizeSpeech(text) {
  if (!text) return null;
  if (!client) {
    const error = new Error('Speech synthesis is not configured. Add SARVAM_API_KEY to server/.env.');
    error.code = 'SARVAM_NOT_CONFIGURED';
    throw error;
  }
  const response = await client.textToSpeech.convert({
    text: text.slice(0, 2500),
    model: env.ttsModel,
    speaker: env.ttsSpeaker,
    language_code: env.ttsLanguage,
    speech_sample_rate: 24000
  });
  const audio = response.audios?.[0];
  return audio ? { audio, mimeType: 'audio/wav' } : null;
}
