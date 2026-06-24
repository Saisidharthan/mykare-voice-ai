/**
 * Real-time tool-call status panel.
 * Shows each tool invocation with its label and status icon — requirement: visual
 * feedback for every tool call ("Fetching slots...", "Booking confirmed ✅").
 */
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import type { ToolEvent } from "../types";

interface ToolEntry {
  tool: string;
  label: string;
  status: "pending" | "done" | "error";
  id: number;
}

interface ToolStatusProps {
  events: ToolEvent[];
}

function buildEntries(events: ToolEvent[]): ToolEntry[] {
  const entries: ToolEntry[] = [];
  let counter = 0;

  for (const ev of events) {
    if (ev.type === "tool_start") {
      entries.push({ tool: ev.tool, label: ev.label, status: "pending", id: counter++ });
    } else if (ev.type === "tool_done") {
      const idx = [...entries].reverse().findIndex((e) => e.tool === ev.tool && e.status === "pending");
      if (idx !== -1) {
        entries[entries.length - 1 - idx].label = ev.label;
        entries[entries.length - 1 - idx].status = "done";
      }
    } else if (ev.type === "tool_error") {
      const idx = [...entries].reverse().findIndex((e) => e.tool === ev.tool && e.status === "pending");
      if (idx !== -1) {
        entries[entries.length - 1 - idx].label = ev.label;
        entries[entries.length - 1 - idx].status = "error";
      }
    }
  }

  return entries;
}

const TOOL_COLORS: Record<string, string> = {
  identify_user:         "bg-blue-50 border-blue-200",
  fetch_slots:           "bg-purple-50 border-purple-200",
  book_appointment:      "bg-green-50 border-green-200",
  retrieve_appointments: "bg-yellow-50 border-yellow-200",
  cancel_appointment:    "bg-red-50 border-red-200",
  modify_appointment:    "bg-orange-50 border-orange-200",
  end_conversation:      "bg-gray-50 border-gray-200",
};

export function ToolStatus({ events }: ToolStatusProps) {
  const entries = buildEntries(events);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Agent Actions
        </h3>
        <p className="text-sm text-gray-400 italic">
          Tool calls will appear here during the conversation...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
        Agent Actions
      </h3>
      <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm transition-all ${
              TOOL_COLORS[entry.tool] ?? "bg-gray-50 border-gray-200"
            }`}
          >
            {entry.status === "pending" && (
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
            )}
            {entry.status === "done" && (
              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            )}
            {entry.status === "error" && (
              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}
            <span className="text-gray-700 font-medium">{entry.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
