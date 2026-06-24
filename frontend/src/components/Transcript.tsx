import { useEffect, useRef } from "react";
import { Mic, Bot } from "lucide-react";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  id: number;
}

interface TranscriptProps {
  entries: TranscriptEntry[];
}

export function Transcript({ entries }: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Live Transcript
        </h3>
        <p className="text-sm text-gray-400 italic">
          Transcript will appear here as you speak...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
        Live Transcript
      </h3>
      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`flex gap-2 items-start ${
              entry.role === "user" ? "flex-row-reverse" : "flex-row"
            }`}
          >
            {/* Avatar icon */}
            <div
              className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${
                entry.role === "user"
                  ? "bg-blue-100"
                  : "bg-mykare-100"
              }`}
            >
              {entry.role === "user" ? (
                <Mic className="w-3 h-3 text-blue-500" />
              ) : (
                <Bot className="w-3 h-3 text-mykare-600" />
              )}
            </div>

            {/* Bubble */}
            <div
              className={`text-sm px-3 py-2 rounded-2xl max-w-[85%] leading-snug ${
                entry.role === "user"
                  ? "bg-blue-500 text-white rounded-tr-sm"
                  : "bg-gray-100 text-gray-800 rounded-tl-sm"
              }`}
            >
              {entry.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
