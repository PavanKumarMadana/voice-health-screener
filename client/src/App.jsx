import { useEffect, useRef, useState } from 'react';
import { Activity, AudioLines, CircleStop, Mic, MicOff, Phone, Send, ShieldCheck, Sparkles } from 'lucide-react';

const API_URL = (import.meta.env.VITE_API_URL || '').trim();
const WS_URL = (import.meta.env.VITE_WS_URL || '').trim()
  || (API_URL ? `${API_URL.replace(/^http/, 'ws')}/ws` : 'ws://localhost:8787/ws');
const initialReport = null;

function StatusBadge({ status }) {
  const labels = { IDLE: 'Ready', CONNECTING: 'Connecting', LISTENING: 'Listening', PROCESSING: 'Thinking', SPEAKING: 'Speaking', ENDING: 'Ending call', REPORT_READY: 'Report ready', ERROR: 'Needs attention' };
  return <span className={`status status-${status.toLowerCase()}`}><span className="status-dot" />{labels[status] || status}</span>;
}

function Report({ report }) {
  if (!report) return <div className="report-empty"><Activity size={28} /><p>Your structured intake report will appear here when the call ends.</p></div>;
  return <div className="report-content">
    <div className="report-status"><span>{report.status === 'COMPLETE' ? 'Complete intake' : 'Partial intake'}</span><ShieldCheck size={17} /></div>
    <div className="report-grid">
      <div><small>Patient name</small><strong>{report.patientName}</strong></div>
      <div><small>Severity</small><strong>{report.severity}</strong></div>
      <div className="wide"><small>Main concern</small><strong>{report.chiefComplaint}</strong></div>
      <div className="wide"><small>Onset & duration</small><strong>{report.onset} · {report.duration}</strong></div>
      <div className="wide"><small>Associated symptoms</small><strong>{report.associatedSymptoms?.length ? report.associatedSymptoms.join(', ') : 'None provided'}</strong></div>
    </div>
    <section><small>Summary</small><p>{report.summary}</p></section>
    <section className="follow-up"><small>Follow-up / red flags</small><p>{report.flaggedFollowUp}</p></section>
  </div>;
}

export default function App() {
  const [status, setStatus] = useState('IDLE');
  const [messages, setMessages] = useState([]);
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState('');
  const [micState, setMicState] = useState('Microphone off');
  const [textInput, setTextInput] = useState('');
  const [textSubmitting, setTextSubmitting] = useState(false);
  const socketRef = useRef(null);
  const recorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recorderStopPromiseRef = useRef(Promise.resolve());
  const streamRef = useRef(null);
  const audioQueueRef = useRef([]);
  const audioPlayingRef = useRef(false);
  const endingRef = useRef(false);
  const transcriptEndRef = useRef(null);
  const audioCtxRef = useRef(null);
  const pendingListenRef = useRef(false);

  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => () => cleanup(), []);

  function cleanup() {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    socketRef.current?.close();
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
    pendingListenRef.current = false;
    recordedChunksRef.current = [];
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }

  function send(event, data = {}) {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ event, data }));
  }

  async function startCall() {
    endingRef.current = false;
    setError(''); setReport(null); setMessages([]); setStatus('CONNECTING');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream; setMicState('Microphone ready');
      const socket = new WebSocket(WS_URL); socketRef.current = socket;
      socket.onopen = () => { send('START_CALL'); setStatus('LISTENING'); };
      socket.onmessage = (event) => handleMessage(JSON.parse(event.data));
      socket.onerror = () => { setError('Connection failed. Check that the server is running.'); setStatus('ERROR'); };
      socket.onclose = () => { if (!endingRef.current) { setError('The call connection closed unexpectedly.'); setStatus('ERROR'); } };
    } catch (caught) { setError(caught.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow access and try again.' : 'Microphone is unavailable in this browser.'); setMicState('Microphone unavailable'); setStatus('ERROR'); }
  }

  function handleMessage(message) {
    const { event, data } = message;
    if (event === 'STATUS') {
      const nextStatus = data.status === 'CONNECTED' ? 'LISTENING' : data.status;
      if (nextStatus === 'LISTENING' && (audioPlayingRef.current || audioQueueRef.current.length)) {
        pendingListenRef.current = true;
        return;
      }
      setStatus(nextStatus);
      if (nextStatus === 'LISTENING') setTextSubmitting(false);
    }
    if (event === 'ERROR') {
      setError(data.message);
      setStatus('LISTENING');
      setTextSubmitting(false);
    }
    if (event === 'AGENT_TEXT') setMessages((current) => current.some((item) => item.role === 'assistant' && item.text === data.text) ? current : [...current, { role: 'assistant', text: data.text }]);
    if (event === 'TRANSCRIPT_UPDATE') setMessages((current) => current.some((item) => item.role === data.role && item.text === data.text) ? current : [...current, { role: data.role, text: data.text }]);
    if (event === 'AGENT_AUDIO' && data.audio) queueAudio(data.audio, data.mimeType);
    if (event === 'FINAL_REPORT') { setReport(data.report); setStatus('REPORT_READY'); }
    if (event === 'CALL_ENDED') { stopRecording(); setMicState('Microphone off'); }
  }

  function queueAudio(base64, mimeType) { setStatus('SPEAKING'); audioQueueRef.current.push({ base64, mimeType }); playNextAudio(); }
  function playNextAudio() {
    if (audioPlayingRef.current || !audioQueueRef.current.length) return;
    audioPlayingRef.current = true;
    const next = audioQueueRef.current.shift();
    const audio = new Audio(`data:${next.mimeType};base64,${next.base64}`);
    const finishPlayback = () => {
      audioPlayingRef.current = false;
      if (pendingListenRef.current) { pendingListenRef.current = false; setStatus('LISTENING'); setTextSubmitting(false); }
      playNextAudio();
    };
    audio.onended = finishPlayback;
    audio.onerror = () => { setError('AI audio could not be played, but you can continue by speaking.'); finishPlayback(); };
    audio.play().catch(() => { setError('AI audio could not be played, but you can continue by speaking.'); finishPlayback(); });
  }

  function beginRecording() {
    if (!streamRef.current || status !== 'LISTENING' || recorderRef.current?.state === 'recording') return;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recordedChunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size) recordedChunksRef.current.push(event.data); };
    recorderStopPromiseRef.current = new Promise((resolve) => {
      recorder.onstop = async () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        try {
          const blob = new Blob(chunks, { type: mimeType });
          const wav = await blobToWavBase64(blob);
          send('AUDIO_CHUNK', { chunk: wav.base64, mimeType: wav.mimeType });
          send('USER_TURN_END', { mimeType: wav.mimeType });
        } catch (error) {
          setError('The recording could not be converted to speech. Please try again or type your answer.');
          send('USER_TURN_END', { mimeType: 'audio/wav' });
        }
        resolve();
      };
    });
    recorder.onerror = () => setError('Recording failed. Please try again.');
    recorder.start(250); recorderRef.current = recorder; setMicState('Listening to you');
  }

  function stopRecording() { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); recorderRef.current = null; if (status === 'LISTENING') setMicState('Microphone ready'); return recorderStopPromiseRef.current; }
  async function endCall() { endingRef.current = true; await stopRecording(); send('END_CALL'); streamRef.current?.getTracks().forEach((track) => track.stop()); setMicState('Microphone off'); }
  function sendText(event) {
    event?.preventDefault();
    const text = textInput.trim();
    if (!text) { setError('Type an answer before sending.'); return; }
    if (!active || status !== 'LISTENING' || textSubmitting) return;
    setError(''); setTextSubmitting(true); setTextInput(''); send('TEXT_TURN', { text });
  }
  function getAudioContext() {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtxRef.current;
  }
  async function blobToWavBase64(blob) {
    const ctx = getAudioContext();
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const sampleRate = 16000;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return { base64: bytesToBase64(new Uint8Array(encodeWavPCM(rendered.getChannelData(0), sampleRate))), mimeType: 'audio/wav' };
  }
  function encodeWavPCM(samples, sampleRate) {
    const len = samples.length;
    const buffer = new ArrayBuffer(44 + len * 2);
    const view = new DataView(buffer);
    const write = (offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true); write(8, 'WAVE');
    write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return buffer;
  }
  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    return btoa(binary);
  }

  const active = ['CONNECTING', 'LISTENING', 'PROCESSING', 'SPEAKING', 'ENDING'].includes(status);
  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Activity size={21} /></span><span>Pulse Intake</span></div><div className="privacy"><ShieldCheck size={16} /> Preliminary intake only</div></header>
    <section className="intro"><div><p className="eyebrow">SASAHYOG TECHNOLOGIES / VOICE HEALTH</p><h1>A calmer way to<br /><em>start the conversation.</em></h1><p className="lede">Speak naturally with an empathetic intake assistant. Your answers become a clear summary for a healthcare professional.</p></div><div className="intro-orbit"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><AudioLines size={37} /></div></section>
    <section className="workspace">
      <div className="panel call-panel"><div className="panel-heading"><div><p className="kicker">LIVE SESSION</p><h2>Voice intake</h2></div><StatusBadge status={status} /></div>
        <div className="conversation" aria-live="polite">{messages.length ? messages.map((message, index) => <article className={`message ${message.role}`} key={`${message.role}-${index}`}><span className="message-label">{message.role === 'user' ? 'You' : 'AI assistant'}</span><p>{message.text}</p></article>) : <div className="conversation-empty"><Sparkles size={22} /><p>Start a call to begin your private intake conversation.</p></div>}<div ref={transcriptEndRef} /></div>
        {error && <div className="error-box" role="alert">{error}</div>}
        <form className="text-composer" onSubmit={sendText}><input value={textInput} onChange={(event) => setTextInput(event.target.value)} placeholder="Type an answer if you prefer..." aria-label="Type your answer" disabled={!active || status !== 'LISTENING' || textSubmitting} /><button type="submit" disabled={!active || status !== 'LISTENING' || textSubmitting || !textInput.trim()} aria-label="Send typed answer"><Send size={17} /> Send</button></form>
        <div className="call-footer"><div className="mic-state"><span className={`mic-icon ${active ? 'active' : ''}`}>{active ? <Mic size={17} /> : <MicOff size={17} />}</span><span>{micState}</span></div><div className="controls"><button className="talk-button" onPointerDown={beginRecording} onPointerUp={stopRecording} onPointerLeave={stopRecording} disabled={!active || status !== 'LISTENING'} aria-label="Hold to speak"><Mic size={19} /> Hold to speak</button>{active ? <button className="end-button" onClick={endCall}><CircleStop size={19} /> End Call</button> : <button className="start-button" onClick={startCall} disabled={status === 'CONNECTING'}><Phone size={18} /> Start Call</button>}</div></div>
      </div>
      <aside className="panel report-panel"><div className="panel-heading"><div><p className="kicker">AFTER YOUR CALL</p><h2>Health report</h2></div><span className="report-icon"><Activity size={19} /></span></div><Report report={report} /></aside>
    </section>
    <footer>Information shared here is for preliminary intake and does not replace professional medical advice.</footer>
  </main>;
}
