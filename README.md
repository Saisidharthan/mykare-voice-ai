# Mykare Voice AI Receptionist

A healthcare voice AI receptionist built with **Tavus CVI** (video avatar), **OpenAI GPT-4o-mini**, and **SQLite**. Patients can book, cancel, and reschedule appointments through a natural voice conversation with an AI avatar named **Aria**.

---

## What It Does

- **Video call UI** — Tavus renders a lifelike avatar that speaks and lip-syncs in real time
- **Natural voice booking** — patients speak to Aria, who books appointments in a SQLite database
- **Live transcript** — every word of the conversation appears in real time on screen
- **Agent Actions panel** — shows every tool call (identify, fetch slots, book, cancel) as it happens
- **Appointments dashboard** — admin view with calendar, stats, search, and filter
- **Call history** — every session saved with an AI-generated summary
- **Real-time DB updates** — appointment table refreshes instantly via Server-Sent Events

---

## Architecture

```
Patient (Browser)
      │
      ▼
 Tavus CVI (WebRTC video + STT + TTS)
      │  POST /v1/chat/completions  (OpenAI-compatible)
      ▼
 FastAPI Backend  ──► OpenAI GPT-4o-mini
      │                     │
      │              Tool loop (identify / book / cancel / modify)
      │                     │
      ▼                     ▼
  SQLite DB           SSE Events
      │                     │
      ▼                     ▼
 Admin Dashboard      Live Transcript
```

**Flow:**
1. Patient clicks "Start Call" → browser calls `POST /api/session`
2. Backend creates a Tavus conversation, returns the `conversation_url`
3. Tavus streams video + audio via WebRTC inside an iframe
4. For every patient utterance, Tavus POSTs to `/v1/chat/completions` on our backend
5. Backend strips Tavus metadata, runs the tool loop with GPT-4o-mini, streams response back
6. Tools write to SQLite; SSE pushes transcript + tool events to the frontend in real time

---

## Tech Stack

| Layer | Technology |
|---|---|
| Video avatar | [Tavus CVI](https://tavus.io) |
| LLM | OpenAI GPT-4o-mini |
| Backend | FastAPI + uvicorn |
| Database | SQLite via aiosqlite |
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Tunnel | Cloudflare Quick Tunnels (`cloudflared`) |
| Rate limiting | slowapi |
| Events | Server-Sent Events (SSE) |

---

## Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **cloudflared** CLI — [install guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
- API keys for:
  - [OpenAI](https://platform.openai.com/api-keys)
  - [Tavus](https://tavus.io) — needs a Replica ID from your Tavus account

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/Saisidharthan/mykare-voice-ai.git
cd mykare-voice-ai
```

### 2. Configure backend environment

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in your keys:

```env
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini

TAVUS_API_KEY=your-tavus-api-key
TAVUS_REPLICA_ID=your-replica-id
TAVUS_PERSONA_ID=              # leave blank — auto-created on first run

PUBLIC_BACKEND_URL=            # fill this after step 4
LLM_INTERNAL_KEY=any-secret-string-you-choose

DB_PATH=./mykare.db
```

### 3. Install backend dependencies

```bash
cd backend
python3 -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Start the Cloudflare tunnel

Tavus needs a public HTTPS URL to call your backend. Run this in a **separate terminal** and keep it open:

```bash
cloudflared tunnel --url http://localhost:8001
```

Copy the `https://xxxx.trycloudflare.com` URL it prints and paste it into `backend/.env`:

```env
PUBLIC_BACKEND_URL=https://xxxx.trycloudflare.com
```

> **Important:** Every time the tunnel restarts, the URL changes. You must update `PUBLIC_BACKEND_URL` and clear `TAVUS_PERSONA_ID=` in `.env`, then restart the backend so a new persona is created.

### 5. Start the backend

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

On first run, the backend will:
- Create the SQLite database (`mykare.db`)
- Create a Tavus persona pointing to your tunnel URL
- Print the persona ID — **save it** to `TAVUS_PERSONA_ID=` in `.env` so it's reused on restarts

Verify it's working:
```bash
curl http://localhost:8001/health
# → {"status":"ok","service":"mykare-agent","persona_id":"p..."}
```

### 6. Install and start the frontend

Open a **new terminal**:

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at **http://localhost:5173**

### 7. Open the app

Go to **http://localhost:5173** and click **Start Call**. Aria will greet you and you can start booking appointments by voice.

---

## Project Structure

```
mykare-voice-ai/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI routes, SSE endpoints, session creation
│   │   ├── llm.py           # OpenAI tool loop, dedup, session state, summary
│   │   ├── tools.py         # Tool execution (identify, book, cancel, modify)
│   │   ├── database.py      # SQLite helpers, slot management, booking logic
│   │   ├── prompts.py       # System prompt + tool definitions for GPT-4o-mini
│   │   ├── tavus_client.py  # Tavus API (persona + conversation creation)
│   │   ├── events.py        # SSE queues (per-session + admin broadcast)
│   │   └── config.py        # Pydantic settings from .env
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/
    └── src/
        ├── App.tsx                        # Root — page nav, call state, event wiring
        ├── components/
        │   ├── TavusAvatar.tsx            # Tavus iframe + live call UI
        │   ├── Transcript.tsx             # Real-time chat bubble transcript
        │   ├── ToolStatus.tsx             # Agent Actions panel
        │   ├── AppointmentsPage.tsx       # Calendar + table admin view
        │   ├── CallHistoryPage.tsx        # Session history with summaries
        │   └── CallSummary.tsx            # Post-call summary modal
        ├── hooks/
        │   └── useEventStream.ts          # SSE subscription hook
        └── types.ts
```

---

## Appointment Slots

The clinic offers 7 slots per day (no lunch):

| Time | Label |
|---|---|
| 09:00 | 9 AM |
| 10:00 | 10 AM |
| 11:00 | 11 AM |
| 14:00 | 2 PM |
| 15:00 | 3 PM |
| 16:00 | 4 PM |
| 17:00 | 5 PM |

---

## What Aria Can Do

Say any of the following during a call:

- *"I'd like to book an appointment for tomorrow at 10 AM"*
- *"Can I see my upcoming appointments?"*
- *"I need to cancel my appointment on Friday"*
- *"Can you reschedule me to 3 PM instead?"*
- *"Change my appointment to a dental consultation"*

---

## Admin Dashboard

Visit **http://localhost:5173** and click **Appointments** or **Call History** in the nav.

**Appointments tab:**
- 4 stat cards (confirmed, cancelled, patients, total calls)
- Interactive calendar — click any date to see all booked/available slots for that day
- Searchable + filterable appointments table
- Real-time updates via SSE — reflects bookings within milliseconds

**Call History tab:**
- Every call session with patient name, duration, and intent
- Click a session to expand the AI-generated summary and list of actions taken

---

## Tunnel Restart Procedure

When the Cloudflare tunnel dies (after restart or long idle), follow these steps:

```bash
# 1. Start a new tunnel
cloudflared tunnel --url http://localhost:8001
# Copy the new https://xxxx.trycloudflare.com URL

# 2. Update backend/.env
PUBLIC_BACKEND_URL=https://xxxx.trycloudflare.com
TAVUS_PERSONA_ID=   # clear this so a new persona is created

# 3. Restart the backend
# Ctrl+C the running uvicorn, then:
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# 4. Save the new persona ID printed in the logs to .env
TAVUS_PERSONA_ID=p...
```

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Your OpenAI API key |
| `OPENAI_MODEL` | Yes | Model to use (e.g. `gpt-4o-mini`) |
| `TAVUS_API_KEY` | Yes | Your Tavus platform API key |
| `TAVUS_REPLICA_ID` | Yes | Tavus replica ID for the avatar |
| `TAVUS_PERSONA_ID` | No | Auto-created on first run; save to reuse |
| `PUBLIC_BACKEND_URL` | Yes | HTTPS URL Tavus uses to call your LLM endpoint |
| `LLM_INTERNAL_KEY` | Yes | Bearer token for authenticating Tavus → your backend |
| `DB_PATH` | No | SQLite path (default: `./mykare.db`) |

---

## Built With

This project was built as a take-home assignment for **Mykare Health**, demonstrating a full-stack voice AI healthcare receptionist using Tavus CVI for avatar rendering, OpenAI for natural language understanding and tool calling, and a custom FastAPI backend to wire them together.
