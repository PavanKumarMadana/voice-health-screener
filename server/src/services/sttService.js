import { SarvamAIClient } from 'sarvamai';
import { env } from '../config/env.js';

const client = env.sarvamKey ? new SarvamAIClient({ apiSubscriptionKey: env.sarvamKey, timeoutInSeconds: Math.ceil(env.requestTimeoutMs / 1000), maxRetries: 0 }) : null;

export async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  if (!audioBuffer?.length) return { text: '', languageCode: null };
  if (!client) {
    const error = new Error('Speech recognition is not configured. Add SARVAM_API_KEY to server/.env.');
    error.code = 'SARVAM_NOT_CONFIGURED';
    throw error;
  }

  const type = (mimeType || '').toLowerCase();
  const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : type.includes('mp3') ? 'mp3' : type.includes('flac') ? 'flac' : 'webm';
  const file = new File([audioBuffer], `turn.${extension}`, { type: type || 'audio/wav' });
  const result = await client.speechToText.transcribe({
    file,
    model: env.sttModel,
    mode: env.sttMode,
    language_code: 'unknown'
  });
  return { text: (result.transcript || '').trim(), languageCode: result.language_code || null };
}
