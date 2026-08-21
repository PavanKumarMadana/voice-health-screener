import { v4 as uuid } from 'uuid';
import { transcribeAudio } from '../services/sttService.js';
import { greeting, respondToTurn } from '../services/llmService.js';
import { synthesizeSpeech } from '../services/ttsService.js';
import { generateReport } from '../services/reportService.js';
import { env } from '../config/env.js';

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_LENGTH = 2000;
const allowedEvents = new Set(['START_CALL', 'AUDIO_CHUNK', 'USER_TURN_END', 'TEXT_TURN', 'END_CALL', 'PING']);

function send(socket, event, data = {}) {
  if (socket.readyState === 1) socket.send(JSON.stringify({ event, data }));
}

function createSession() {
  return {
    sessionId: uuid(),
    callStartedAt: null,
    callEndedAt: null,
    active: false,
    processing: false,
    audioChunks: [],
    audioBytes: 0,
    transcript: [],
    history: [],
    language: 'en-IN',
    state: { patientName: null, chiefComplaint: null, onset: null, duration: null, severity: null, associatedSymptoms: [], redFlags: [] }
  };
}

function applyStateUpdate(state, update) {
  for (const [key, value] of Object.entries(update || {})) {
    if (!(key in state) || value == null) continue;
    state[key] = key === 'associatedSymptoms' || key === 'redFlags' ? (Array.isArray(value) ? value : [String(value)]) : String(value);
  }
}

function providerMessage(error, fallback) {
  const status = error?.statusCode || error?.status;
  const app = env.appName;
  if (error?.code === 'SARVAM_NOT_CONFIGURED') return `${app} speech services are not configured on the server yet. Please check the setup and try again.`;
  if (status === 403) return `${fallback} There may be a problem with the ${app} speech service credentials.`;
  if (status === 429) return `${fallback} The ${app} speech service is busy or its free quota may be exhausted. Please wait a moment and try again.`;
  if (status >= 500) return `${fallback} The ${app} speech service is temporarily unavailable. Please try again in a moment.`;
  return fallback;
}

function logProviderError(service, error) {
  console.error('[provider-error]', JSON.stringify({
    service,
    code: error?.code || null,
    status: error?.statusCode || error?.status || null,
    type: error?.constructor?.name || 'Error',
    message: error?.message || 'Unknown provider error'
  }));
}

async function processUserText(socket, session, text) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    send(socket, 'AGENT_TEXT', { text: "I didn't catch that. Please speak again or type your answer." });
    send(socket, 'STATUS', { status: 'LISTENING' });
    return;
  }
  if (!session.active || session.processing) return;

  session.processing = true;
  send(socket, 'STATUS', { status: 'PROCESSING' });
  session.transcript.push({ role: 'user', text: normalizedText, at: new Date().toISOString() });
  session.history.push({ role: 'user', text: normalizedText });
  send(socket, 'TRANSCRIPT_UPDATE', { role: 'user', text: normalizedText });

  try {
    let response;
    try {
      response = await respondToTurn({ history: session.history, state: session.state, userText: normalizedText });
    } catch (error) {
      logProviderError('llm', error);
      send(socket, 'ERROR', { message: providerMessage(error, `${env.appName} couldn't process that answer. Please try again or type it differently.`) });
      send(socket, 'STATUS', { status: 'LISTENING' });
      return;
    }

    applyStateUpdate(session.state, response.stateUpdate);
    session.transcript.push({ role: 'assistant', text: response.reply, at: new Date().toISOString() });
    session.history.push({ role: 'assistant', text: response.reply });
    send(socket, 'TRANSCRIPT_UPDATE', { role: 'assistant', text: response.reply });
    send(socket, 'AGENT_TEXT', { text: response.reply });
    send(socket, 'STATUS', { status: 'SPEAKING' });

    try {
      const audio = await synthesizeSpeech(response.reply);
      if (audio) send(socket, 'AGENT_AUDIO', audio);
    } catch (error) {
      logProviderError('tts', error);
      send(socket, 'ERROR', { message: providerMessage(error, `Your answer is ready on screen, but ${env.appName} couldn't create the voice reply.`) });
    }
  } finally {
    session.processing = false;
    if (session.active) send(socket, 'STATUS', { status: 'LISTENING' });
  }
}

export function attachCallHandler(socket) {
  const session = createSession();
  send(socket, 'STATUS', { status: 'IDLE', sessionId: session.sessionId });

  socket.on('message', async (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { send(socket, 'ERROR', { message: 'Invalid message format.' }); return; }
    if (!message || !allowedEvents.has(message.event)) { send(socket, 'ERROR', { message: 'Unsupported event.' }); return; }

    if (message.event === 'PING') { send(socket, 'STATUS', { status: 'CONNECTED' }); return; }

    if (message.event === 'START_CALL') {
      if (session.active) return;
      session.active = true;
      session.callStartedAt = new Date().toISOString();
      session.transcript = [];
      session.history = [];
      session.audioChunks = [];
      session.audioBytes = 0;
      session.processing = true;
      send(socket, 'STATUS', { status: 'SPEAKING', sessionId: session.sessionId });

      let text = greeting();
      try {
        const response = await respondToTurn({ history: [], state: session.state, userText: 'Start the health intake with a brief empathetic greeting and ask for the patient name.' });
        text = response.reply || text;
      } catch (error) {
        logProviderError('llm-greeting', error);
        // Seamless fallback to the static greeting below; no need to alarm the user.
      }
      session.transcript.push({ role: 'assistant', text, at: new Date().toISOString() });
      session.history.push({ role: 'assistant', text });
      send(socket, 'AGENT_TEXT', { text });
      try {
        const audio = await synthesizeSpeech(text);
        if (audio) send(socket, 'AGENT_AUDIO', audio);
      } catch (error) {
        logProviderError('tts-greeting', error);
        send(socket, 'ERROR', { message: providerMessage(error, `The greeting is on screen, but ${env.appName} couldn't create the voice greeting.`) });
      } finally {
        session.processing = false;
        if (session.active) send(socket, 'STATUS', { status: 'LISTENING' });
      }
      return;
    }

    if (message.event === 'TEXT_TURN') {
      const text = String(message.data?.text || '').trim();
      if (!text) { send(socket, 'ERROR', { message: 'Type an answer before sending.' }); return; }
      if (text.length > MAX_TEXT_LENGTH) { send(socket, 'ERROR', { message: 'That answer is too long. Please keep it under 2,000 characters.' }); return; }
      await processUserText(socket, session, text);
      return;
    }

    if (message.event === 'AUDIO_CHUNK') {
      if (!session.active || session.processing) return;
      const chunk = Buffer.from(String(message.data?.chunk || ''), 'base64');
      if (!chunk.length || session.audioBytes + chunk.length > MAX_AUDIO_BYTES) { send(socket, 'ERROR', { message: 'Audio turn is empty or too large.' }); return; }
      session.audioChunks.push(chunk);
      session.audioBytes += chunk.length;
      return;
    }

    if (message.event === 'USER_TURN_END') {
      if (!session.active || session.processing) return;
      if (!session.audioChunks.length) { send(socket, 'ERROR', { message: "I didn't hear anything. Please try again or type your answer." }); return; }
      const audio = Buffer.concat(session.audioChunks);
      session.audioChunks = [];
      session.audioBytes = 0;
      try {
        const result = await transcribeAudio(audio, message.data?.mimeType || 'audio/webm');
        if (result.languageCode) session.language = result.languageCode;
        await processUserText(socket, session, result.text);
      } catch (error) {
        logProviderError('stt', error);
        send(socket, 'ERROR', { message: providerMessage(error, `${env.appName} couldn't hear that clearly. Please speak again near the microphone or type your answer.`) });
        send(socket, 'STATUS', { status: 'LISTENING' });
      }
      return;
    }

    if (message.event === 'END_CALL') {
      if (!session.active) return;
      session.active = false;
      session.callEndedAt = new Date().toISOString();
      session.audioChunks = [];
      session.audioBytes = 0;
      send(socket, 'STATUS', { status: 'ENDING' });
      const report = await generateReport({ state: session.state, transcript: session.transcript });
      send(socket, 'FINAL_REPORT', { report });
      send(socket, 'CALL_ENDED', { sessionId: session.sessionId, endedAt: session.callEndedAt });
    }
  });

  socket.on('close', () => { session.active = false; session.audioChunks = []; });
}
