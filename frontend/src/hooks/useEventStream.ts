import { useEffect, useRef } from "react";
import type { ToolEvent } from "../types";

export function useEventStream(
  sessionId: string | null,
  onEvent: (event: ToolEvent) => void
) {
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!sessionId) return;

    let closed = false;

    function connect() {
      if (closed) return;
      const es = new EventSource(`/api/events/${sessionId}`);
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const event: ToolEvent = JSON.parse(e.data);
          onEventRef.current(event);
          // Close cleanly on server-sent close event
          if (event.type === "close") {
            closed = true;
            es.close();
          }
        } catch {
          // ignore malformed
        }
      };

      es.onerror = () => {
        // Don't close — browser will auto-reconnect via EventSource spec.
        // Only close if we intentionally ended the session.
      };
    }

    connect();

    return () => {
      closed = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [sessionId]);
}
