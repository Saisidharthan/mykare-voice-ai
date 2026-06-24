import { useCallback, useRef, useState } from "react";
import { Phone, PhoneOff, Stethoscope, Calendar, Video, History } from "lucide-react";
import { TavusAvatar } from "./components/TavusAvatar";
import { ToolStatus } from "./components/ToolStatus";
import { Transcript } from "./components/Transcript";
import { CallSummaryModal } from "./components/CallSummary";
import { AppointmentsPage } from "./components/AppointmentsPage";
import { CallHistoryPage } from "./components/CallHistoryPage";
import { useEventStream } from "./hooks/useEventStream";
import type { CallSummary, CallState, ToolEvent } from "./types";

type Page = "call" | "appointments" | "history";

export default function App() {
  const [page, setPage] = useState<Page>("call");
  const [callState, setCallState] = useState<CallState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationUrl, setConversationUrl] = useState<string | null>(null);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [transcript, setTranscript] = useState<{role:"user"|"assistant";text:string;id:number}[]>([]);
  const transcriptCounter = useRef(0);
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEvent = useCallback((event: ToolEvent) => {
    if (event.type === "transcript") {
      setTranscript((prev) => [
        ...prev,
        { role: event.role, text: event.text, id: transcriptCounter.current++ },
      ]);
    } else if (event.type === "summary") {
      setSummary(event.data);
      setShowSummary(true);
      setCallState("ended");
    } else if (event.type === "close") {
      setCallState("ended");
    } else if (event.type !== "connected" && event.type !== "ping") {
      setToolEvents((prev) => [...prev, event]);
    }
  }, []);

  useEventStream(sessionId, handleEvent);

  async function startCall() {
    setError(null);
    setCallState("connecting");
    setToolEvents([]);
    setTranscript([]);
    setSummary(null);

    try {
      const res = await fetch("/api/session", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Server error ${res.status}`);
      }
      const data = await res.json();
      setSessionId(data.session_id);
      setConversationUrl(data.conversation_url);
      setCallState("active");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start call");
      setCallState("idle");
    }
  }

  function endCall() {
    setCallState("ended");
    setConversationUrl(null);
    if (summary) setShowSummary(true);
  }

  function resetCall() {
    setCallState("idle");
    setSessionId(null);
    setConversationUrl(null);
    setToolEvents([]);
    setTranscript([]);
    setSummary(null);
    setShowSummary(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-mykare-50 via-white to-blue-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-mykare-600 flex items-center justify-center">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-gray-900 text-lg">Mykare Health</span>
            <span className="text-gray-300 text-sm">|</span>
            <span className="text-sm text-gray-500">AI Receptionist</span>
          </div>

          {/* Nav tabs */}
          <nav className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setPage("call")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                page === "call"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              Call
              {callState === "active" && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              )}
            </button>
            <button
              onClick={() => setPage("appointments")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                page === "appointments"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Appointments
            </button>
            <button
              onClick={() => setPage("history")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                page === "history"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Call History
            </button>
          </nav>

          {/* Live indicator */}
          {callState === "active" && (
            <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live Call
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">

        {/* ── APPOINTMENTS PAGE ── */}
        {page === "appointments" && <AppointmentsPage />}

        {/* ── CALL HISTORY PAGE ── */}
        {page === "history" && <CallHistoryPage />}

        {/* ── CALL PAGE ── */}
        {page === "call" && (
          <>
            {/* Idle */}
            {callState === "idle" && (
              <div className="flex flex-col items-center justify-center min-h-[70vh] text-center gap-6">
                <div className="w-24 h-24 rounded-full bg-mykare-100 flex items-center justify-center shadow-lg">
                  <Stethoscope className="w-12 h-12 text-mykare-600" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">Talk to Aria</h1>
                  <p className="text-gray-500 max-w-md">
                    Your AI healthcare receptionist. Book, manage, or cancel appointments — just speak naturally.
                  </p>
                </div>
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl max-w-sm">
                    {error}
                  </div>
                )}
                <button
                  onClick={startCall}
                  className="flex items-center gap-3 bg-mykare-600 hover:bg-mykare-700 text-white font-semibold px-8 py-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 text-lg"
                >
                  <Phone className="w-5 h-5" />
                  Start Call
                </button>
                <p className="text-xs text-gray-400">Powered by Tavus · OpenAI · Mykare Health</p>
              </div>
            )}

            {/* Connecting */}
            {callState === "connecting" && (
              <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4">
                <div className="w-16 h-16 rounded-full border-4 border-mykare-200 border-t-mykare-600 animate-spin" />
                <p className="text-gray-600 font-medium">Connecting to Aria...</p>
              </div>
            )}

            {/* Active call */}
            {callState === "active" && conversationUrl && (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Avatar */}
                <div className="lg:col-span-3 flex flex-col gap-4">
                  <TavusAvatar conversationUrl={conversationUrl} />
                  <button
                    onClick={endCall}
                    className="flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
                  >
                    <PhoneOff className="w-4 h-4" />
                    End Call
                  </button>
                </div>

                {/* Sidebar */}
                <div className="flex flex-col gap-4">
                  {/* Live transcript */}
                  <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                    <Transcript entries={transcript} />
                  </div>

                  {/* Tool status */}
                  <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                    <ToolStatus events={toolEvents} />
                  </div>

                  {/* Tips */}
                  <div className="bg-mykare-50 rounded-2xl p-5 border border-mykare-100">
                    <h3 className="text-sm font-semibold text-mykare-700 mb-3">You can ask Aria to:</h3>
                    <ul className="flex flex-col gap-1.5 text-sm text-mykare-600">
                      {[
                        "Book an appointment",
                        "Show my appointments",
                        "Cancel a booking",
                        "Reschedule an appointment",
                      ].map((tip) => (
                        <li key={tip} className="flex items-center gap-2">
                          <span className="text-mykare-400">→</span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Ended */}
            {callState === "ended" && !showSummary && (
              <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 text-center">
                <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                  <span className="text-4xl">✓</span>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">Call Ended</h2>
                  <p className="text-gray-500">Thank you for using Mykare Health.</p>
                </div>
                <div className="flex gap-3">
                  {summary && (
                    <button
                      onClick={() => setShowSummary(true)}
                      className="px-6 py-3 bg-mykare-600 text-white rounded-xl font-semibold hover:bg-mykare-700 transition-colors"
                    >
                      View Summary
                    </button>
                  )}
                  <button
                    onClick={() => setPage("appointments")}
                    className="px-6 py-3 border border-mykare-200 text-mykare-700 rounded-xl font-semibold hover:bg-mykare-50 transition-colors"
                  >
                    View Appointments
                  </button>
                  <button
                    onClick={resetCall}
                    className="px-6 py-3 border border-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
                  >
                    New Call
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Summary modal */}
      {showSummary && summary && (
        <CallSummaryModal
          summary={summary}
          onClose={() => {
            setShowSummary(false);
            if (callState === "ended") resetCall();
          }}
        />
      )}
    </div>
  );
}
