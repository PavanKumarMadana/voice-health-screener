import 'dotenv/config';

export const env = {
  appName: process.env.APP_NAME || 'Pulse Intake',
  port: Number(process.env.PORT || 8787),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  clientOrigins: (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean),
  sarvamKey: process.env.SARVAM_API_KEY || '',
  sttModel: process.env.SARVAM_STT_MODEL || 'saaras:v3',
  sttMode: process.env.SARVAM_STT_MODE || 'codemix',
  llmModel: process.env.SARVAM_LLM_MODEL || 'sarvam-105b-conversations',
  ttsModel: process.env.SARVAM_TTS_MODEL || 'bulbul:v3',
  ttsSpeaker: process.env.SARVAM_TTS_SPEAKER || 'shubh',
  ttsLanguage: process.env.SARVAM_TTS_LANGUAGE || 'en-IN',
  requestTimeoutMs: Number(process.env.SARVAM_REQUEST_TIMEOUT_MS || 15000)
};
