export type ToolEvent =
  | { type: "connected" }
  | { type: "ping" }
  | { type: "tool_start"; tool: string; label: string }
  | { type: "tool_done";  tool: string; label: string; result: unknown }
  | { type: "tool_error"; tool: string; label: string }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "summary";    data: CallSummary }
  | { type: "close" };

export interface CallSummary {
  summary: string;
  appointments: AppointmentSummary[];
  patient_name: string | null;
  phone_number: string | null;
  intent: string;
  timestamp: string;
}

export interface AppointmentSummary {
  date: string;
  time: string;
  action: string;
}

export type CallState = "idle" | "connecting" | "active" | "ended";
