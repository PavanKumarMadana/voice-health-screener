# Pulse Intake: Voice Health Screener

A real-time voice health-intake web application for Sasahyog Technologies. A user speaks with an empathetic AI intake assistant, sees the live transcript, and receives a structured preliminary report when the call ends. This is an **intake aid, not a diagnostic system**.

## Overview

Pulse Intake conducts a preliminary health-intake conversation using **voice (primary)** and **text (fallback)**. Speech is transcribed, a conversational AI asks one adaptive health question at a time while remembering answers, the reply is spoken back through text-to-speech, and a structured report is produced when the call ends. Both voice and text share the same conversation state.

## Key Features

- Start/end call controls with microphone permission handling.
- Real **Speech-to-Text**, conversational **LLM**, and **Text-to-Speech** via Sarvam AI.
- Turn-based microphone capture, converted in-browser to 16 kHz WAV for reliable transcription.
- One-question-at-a-time, adaptive, context-aware health-intake questions.
- AI response **text appears immediately** while the **TTS audio plays concurrently**.
- Text input as a full secondary interaction mode, sharing the same session state.
- Live user/AI transcript and a structured intake report on call end.
- Complete / incomplete intake handling and graceful provider-error recovery.
- No real secrets stored in the repository.

## Architecture

```text
Browser
  ΓööΓöÇ React UI (Vite) ΓöÇΓöÇ WebSocket (/ws) ΓöÇΓöÇΓû║ Node.js + Express + ws
                                               Γöé  turn-based audio (base64 WAV) or typed text
                                               Γû╝
                              Sarvam Saaras v3 STT ΓöÇΓöÇΓû║ Sarvam-105B Conversations ΓöÇΓöÇΓû║ Sarvam Bulbul v3 TTS
                                               Γöé
                                               Γû╝
                              AGENT_TEXT (immediately) + AGENT_AUDIO (base64 WAV)
                                               Γû╝
                               React transcript + concurrent audio playback
                                               Γöé
                                               ΓööΓöÇΓû║ structured report on END_CALL
```

### Render deployment architecture (two services)

- **Frontend** ΓÇö Render **Static Site** (Vite React build, publish directory `dist`).
- **Backend** ΓÇö Render **Web Service** (Node.js/Express + WebSocket on `/ws`), which also hosts the `/health` endpoint.

The frontend connects to the deployed backend over `wss://<backend>.onrender.com/ws`.

## Technology Stack

- React 18, Vite, JavaScript
- Node.js, Express, `ws`
- Sarvam AI: `saaras:v3` for STT, `sarvam-105b-conversations` for intake and report generation, `bulbul:v3` with `shubh` for TTS
- `lucide-react` for interface icons

## Running Locally

In one terminal:

```bash
npm run dev --prefix server
```

In another terminal:

```bash
npm run dev --prefix client
```

Open `http://localhost:5173`. The dev WebSocket URL defaults to `ws://localhost:8787/ws`.

## How To Test The Call

1. Open the application and select **Start Call**.
2. Allow microphone access.
3. Wait for the audible greeting.
4. Hold **Hold to speak**, answer, then release.
5. Wait for transcription and the AI response.
6. Repeat for several turns and verify questions adapt.
7. Select **End Call** and review the structured report.
8. Repeat by ending immediately to verify the `INCOMPLETE` report.

## Project Structure

```text
voice-health-screener/
Γö£ΓöÇΓöÇ client/                 # React (Vite) frontend
Γöé   Γö£ΓöÇΓöÇ src/App.jsx         # UI, WebSocket handling, audio capture/playback
Γöé   Γö£ΓöÇΓöÇ src/main.jsx
Γöé   Γö£ΓöÇΓöÇ src/styles.css
Γöé   Γö£ΓöÇΓöÇ vite.config.js
Γöé   ΓööΓöÇΓöÇ .env.example        # frontend env template (VITE_API_URL / VITE_WS_URL)
Γö£ΓöÇΓöÇ server/                 # Node.js backend
Γöé   Γö£ΓöÇΓöÇ src/server.js       # Express + HTTP + WebSocket server
Γöé   Γö£ΓöÇΓöÇ src/config/env.js   # environment configuration
Γöé   Γö£ΓöÇΓöÇ src/websocket/callHandler.js
Γöé   Γö£ΓöÇΓöÇ src/services/       # sttService.js, llmService.js, ttsService.js, reportService.js
Γöé   ΓööΓöÇΓöÇ .env.example        # backend env template (never commit .env)
Γö£ΓöÇΓöÇ render.yaml             # Render Blueprint (web service + static site)
Γö£ΓöÇΓöÇ .gitignore
ΓööΓöÇΓöÇ package.json            # root convenience scripts
```

## Prerequisites

- Node.js 20 or newer and npm
- A modern browser with microphone support (localhost is a secure context for development)
- A valid **Sarvam API key** with credits for real STT, LLM, and TTS

## Local Development Setup

From the repository root:

```bash
npm install          # root dev dependencies (concurrently)
npm run install:all  # installs server/ and client/ dependencies
```

Create `server/.env` from `server/.env.example` and set `SARVAM_API_KEY`. **Never commit `server/.env`.**

## Environment Variables

### Backend (`server/.env`, or Render Web Service environment)

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | HTTP/WebSocket port. Render sets this automatically. | `8787` |
| `CLIENT_URL` | Allowed browser origin(s) for CORS; comma-separated list supported. | `http://localhost:5173` |
| `APP_NAME` | Brand name shown to the user. | `Pulse Intake` |
| `SARVAM_API_KEY` | **Required.** Sarvam key for STT, LLM, TTS, and report enhancement. | ΓÇö |
| `SARVAM_STT_MODEL` | Transcription model. | `saaras:v3` |
| `SARVAM_STT_MODE` | Saaras output mode. | `codemix` |
| `SARVAM_LLM_MODEL` | Conversation/report model. | `sarvam-105b-conversations` |
| `SARVAM_TTS_MODEL` | Speech model. | `bulbul:v3` |
| `SARVAM_TTS_SPEAKER` | Bulbul speaker. | `shubh` |
| `SARVAM_TTS_LANGUAGE` | TTS BCP-47 language. | `en-IN` |
| `SARVAM_REQUEST_TIMEOUT_MS` | Provider request timeout. | `15000` |

### Frontend (build-time; set in Render Static Site environment or `client/.env`)

| Variable | Description | Example |
| --- | --- | --- |
| `VITE_API_URL` | Deployed backend HTTP(S) URL. The client derives the WebSocket URL from it. | `https://voice-health-screener-server.onrender.com` |
| `VITE_WS_URL` | Optional explicit WebSocket URL override. If unset, it is derived from `VITE_API_URL` (`http` ΓåÆ `ws`, plus `/ws`). | `wss://voice-health-screener-server.onrender.com/ws` |

Local development works without any frontend env file (defaults to `ws://localhost:8787/ws`).

## Sarvam API Setup

1. Create an account at [Sarvam AI](https://www.sarvam.ai) and generate an API key.
2. Add it to `server/.env` as `SARVAM_API_KEY` (local) or to the Render Web Service environment (production).
3. The key is **server-side only** and is never exposed to the browser or committed to the repository.

## WebSocket Architecture

- The server hosts a `WebSocketServer` on path `/ws` over the same HTTP server.
- Every message is JSON: `{ "event": "EVENT_NAME", "data": {} }`.
- **Client ΓåÆ server:** `START_CALL`, `AUDIO_CHUNK` (base64 chunk + `mimeType`), `USER_TURN_END`, `TEXT_TURN` (typed answer), `END_CALL`, `PING`.
- **Server ΓåÆ client:** `STATUS`, `TRANSCRIPT_UPDATE`, `AGENT_TEXT`, `AGENT_AUDIO` (base64 audio + MIME type), `FINAL_REPORT`, `CALL_ENDED`, `ERROR`.
- Audio is sent per turn with a maximum buffered turn size of 8 MB; unknown events and malformed JSON are rejected.
- The AI text (`AGENT_TEXT`) is emitted immediately after the LLM response; the audio (`AGENT_AUDIO`) is generated and sent independently and plays concurrently without blocking text rendering.

## Render Deployment Steps

The repository includes `render.yaml` (a Render Blueprint). To deploy:

1. Push this repository to a GitHub account connected to Render.
2. In Render, choose **New ΓåÆ Blueprint** and select the repository. Render detects `render.yaml` and creates both services.
3. In the **Web Service ΓåÆ Environment**, set:
   - `SARVAM_API_KEY` ΓÇö your real key.
   - `CLIENT_URL` ΓÇö the **Static Site** URL, e.g. `https://voice-health-screener-client.onrender.com`. Add `http://localhost:5173` if you also want to hit the deployed backend from local dev.
4. Render wires the Static Site's `VITE_API_URL` to the backend automatically via `fromService` in the Blueprint. If you deploy manually instead of with a Blueprint, set `VITE_API_URL` (Static Site environment) to `https://voice-health-screener-server.onrender.com`.
5. The Static Site build command is `npm --prefix client install && npm run build --prefix client` with publish path `client/dist` (Render static builds run from the repo root). The backend health check uses `/health`.
6. Deploy, then trigger a **Blueprint sync / update** (Dashboard → Blueprint) so Render re-reads `render.yaml`; or if the service already exists, update the Static Site's Build command and Publish directory to the values above.

## Required Render Environment Variables

**Web Service (backend):**
- `SARVAM_API_KEY` (required)
- `CLIENT_URL` (required ΓÇö deployed frontend origin)

**Static Site (frontend):**
- `VITE_API_URL` (required so it connects to `wss://<backend>/ws`)

## Build and Start Commands

- **Backend build:** `npm install`
- **Backend start:** `npm start` (i.e. `node src/server.js`)
- **Frontend build (Render):** `npm --prefix client install && npm run build --prefix client` (Vite). Render static builds run from the repository root, so npm's `--prefix client` and a repo-root-relative publish path are used.
- **Frontend publish directory (Render):** `client/dist`
- **Frontend build (local):** `cd client` then `npm install && npm run build`

## Health Check Endpoint

`GET /health` returns:

```json
{ "status": "ok", "service": "voice-health-screener" }
```

It does **not** require Sarvam API access and is used as the Render health check path.

## Security Notes

- **Never commit `server/.env`** ΓÇö it contains the real `SARVAM_API_KEY`.
- `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `node_modules/`, build output, and log files.
- The Sarvam key is only ever read server-side; it is never sent to the browser, never logged as a value, and never placed in `render.yaml`, the README, or source code.
- CORS is restricted to the origins listed in `CLIENT_URL` ΓÇö it does **not** use an insecure permissive wildcard.
- No raw stack traces or API keys are surfaced to the user; provider errors are mapped to friendly messages.

## Failure Handling

Empty turns receive a retry prompt without calling the LLM. STT errors keep the session alive and return the UI to listening. LLM errors preserve the user transcript and return to listening. TTS errors preserve the text response and keep the conversation usable; the AI text remains visible. Reports fall back to collected state and transcript if report generation fails. Microphone denial, WebSocket errors, provider quota errors, and early calls are surfaced in the UI and produce partial reports where possible.

## Limitations and Future Improvements

The current implementation is turn-based rather than full-duplex and uses Sarvam's REST APIs rather than its realtime streaming APIs. Text-to-speech defaults to English; Saaras detects the spoken language and updates per-session metadata. Future work could add automatic TTS language switching, voice activity detection, barge-in cancellation, persistent authenticated sessions, encrypted storage, monitoring, and a production-grade medical safety review.

## Submission Readiness

Secrets are excluded by `.gitignore`; `server/.env.example` and `client/.env.example` are included with placeholder values only. The application runs locally with the commands above and deploys to Render via the included Blueprint. A valid `SARVAM_API_KEY` with available credits is required to exercise the real provider pipeline; Sarvam free-tier limits vary by account.
