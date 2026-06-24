import { useEffect, useState, useCallback } from "react";
import { RefreshCw, PhoneCall, Clock, User, FileText, CheckCircle, XCircle } from "lucide-react";

interface CallSession {
  id: number;
  session_id: string;
  conversation_id: string;
  created_at: string;
  ended_at: string | null;
  summary: {
    summary: string;
    patient_name: string | null;
    phone_number: string | null;
    intent: string;
    appointments: { date: string; time: string; action: string }[];
    timestamp: string;
  } | null;
}

function duration(start: string, end: string | null) {
  if (!end) return "In progress";
  const s = new Date(start + "Z").getTime();
  const e = new Date(end + "Z").getTime();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function CallHistoryPage() {
  const [sessions, setSessions] = useState<CallSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sessions");
      const data = await res.json();
      setSessions(data.sessions);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchSessions();
    const t = setInterval(fetchSessions, 15000);
    return () => clearInterval(t);
  }, [fetchSessions]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Call History</h2>
        <button
          onClick={fetchSessions}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100">
          <PhoneCall className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No calls recorded yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.map((s) => (
            <div key={s.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Row */}
              <button
                className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors"
                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              >
                {/* Icon */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${s.summary ? "bg-green-100" : "bg-yellow-100"}`}>
                  <PhoneCall className={`w-4 h-4 ${s.summary ? "text-green-600" : "text-yellow-600"}`} />
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 text-sm">
                      {s.summary?.patient_name ?? "Unknown Patient"}
                    </span>
                    {s.summary?.phone_number && (
                      <span className="text-xs text-gray-400">{s.summary.phone_number}</span>
                    )}
                    {s.summary ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
                        <CheckCircle className="w-3 h-3" /> Completed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700">
                        <Clock className="w-3 h-3" /> No summary
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {s.summary?.intent ?? "—"} · {duration(s.created_at, s.ended_at)}
                  </p>
                </div>

                {/* Timestamp */}
                <div className="text-xs text-gray-400 text-right flex-shrink-0">
                  {new Date(s.created_at + "Z").toLocaleString("en-IN", {
                    day: "numeric", month: "short",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </div>
              </button>

              {/* Expanded summary */}
              {expanded === s.id && s.summary && (
                <div className="px-5 pb-5 border-t border-gray-50 pt-4 flex flex-col gap-3">
                  {/* Summary text */}
                  <div className="flex gap-2 items-start">
                    <FileText className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-gray-700">{s.summary.summary}</p>
                  </div>

                  {/* Appointments from this call */}
                  {s.summary.appointments?.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions taken</p>
                      {s.summary.appointments.map((a, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                          {a.action?.toLowerCase().includes("cancel") ? (
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                          ) : (
                            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                          )}
                          <span className="capitalize">{a.action}</span>
                          {a.date && <span className="text-gray-400">·</span>}
                          {a.date && <span>{a.date}</span>}
                          {a.time && <span className="text-gray-400">at</span>}
                          {a.time && <span>{a.time}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Patient details */}
                  <div className="flex gap-4 text-xs text-gray-500">
                    {s.summary.patient_name && (
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" /> {s.summary.patient_name}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {duration(s.created_at, s.ended_at)}
                    </span>
                    <span className="text-gray-300 font-mono">{s.conversation_id}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
