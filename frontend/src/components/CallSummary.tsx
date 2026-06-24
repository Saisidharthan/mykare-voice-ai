/**
 * End-of-call summary modal — shows after end_conversation tool fires.
 * Requirement: generate within 10 seconds, display summary + appointments + timestamp.
 */
import { Calendar, Clock, Phone, User, X } from "lucide-react";
import type { CallSummary } from "../types";

interface CallSummaryProps {
  summary: CallSummary;
  onClose: () => void;
}

export function CallSummaryModal({ summary, onClose }: CallSummaryProps) {
  const formattedTime = new Date(summary.timestamp).toLocaleString();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <span className="text-green-600 text-lg">✓</span>
            </div>
            <div>
              <h2 className="font-bold text-gray-900 text-lg">Call Summary</h2>
              <p className="text-xs text-gray-400">{formattedTime}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* Patient info */}
          {(summary.patient_name || summary.phone_number) && (
            <div className="flex gap-4">
              {summary.patient_name && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <User className="w-4 h-4 text-gray-400" />
                  <span>{summary.patient_name}</span>
                </div>
              )}
              {summary.phone_number && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <span>{summary.phone_number}</span>
                </div>
              )}
            </div>
          )}

          {/* Summary text */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-sm text-gray-700 leading-relaxed">{summary.summary}</p>
          </div>

          {/* Intent */}
          {summary.intent && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Intent
              </span>
              <span className="text-sm bg-mykare-50 text-mykare-700 px-3 py-1 rounded-full font-medium">
                {summary.intent}
              </span>
            </div>
          )}

          {/* Appointments */}
          {summary.appointments && summary.appointments.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Appointments
              </h3>
              <div className="flex flex-col gap-2">
                {summary.appointments.map((appt, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-lg px-4 py-2.5"
                  >
                    <Calendar className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-gray-700 font-medium">{appt.date}</span>
                    <Clock className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{appt.time}</span>
                    <span className="ml-auto text-xs text-green-600 font-medium capitalize">
                      {appt.action}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="mt-2 w-full py-3 rounded-xl bg-mykare-600 hover:bg-mykare-700 text-white font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
