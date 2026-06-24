import { useEffect, useState, useCallback, useRef } from "react";
import {
  RefreshCw, Users, CalendarCheck, XCircle, Calendar, Clock,
  Phone, User, FileText, PhoneCall, ChevronLeft, ChevronRight, CheckCircle,
} from "lucide-react";

interface Appointment {
  id: number;
  date: string;
  time_slot: string;
  intent: string;
  status: "confirmed" | "cancelled";
  created_at: string;
  user_id: number;
  patient_name: string;
  patient_phone: string;
}

interface Stats {
  confirmed: number;
  cancelled: number;
  patients: number;
  total_calls: number;
}

const SLOT_TIMES = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function formatTime(slot: string) {
  const [h, min] = slot.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(min).padStart(2, "0")} ${period}`;
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function toISO(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Confirmed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Cancelled
    </span>
  );
}

// ── Calendar ──────────────────────────────────────────────────────────────────

function CalendarView({
  appointments,
  selectedDate,
  onSelectDate,
}: {
  appointments: Appointment[];
  selectedDate: string | null;
  onSelectDate: (d: string) => void;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  // Build a map: date-string → appointments[]
  const apptMap = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const list = apptMap.get(a.date) ?? [];
    list.push(a);
    apptMap.set(a.date, list);
  }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  // Build grid: 6 rows × 7 cols
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronLeft className="w-4 h-4 text-gray-500" />
        </button>
        <h3 className="font-semibold text-gray-900 text-sm">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </h3>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronRight className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
        ))}
      </div>

      {/* Date cells */}
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const iso = toISO(viewYear, viewMonth, day);
          const dayAppts = apptMap.get(iso) ?? [];
          const confirmed = dayAppts.filter(a => a.status === "confirmed");
          const cancelled = dayAppts.filter(a => a.status === "cancelled");
          const isToday = iso === todayISO;
          const isSelected = iso === selectedDate;
          const hasBookings = dayAppts.length > 0;

          return (
            <button
              key={i}
              onClick={() => onSelectDate(iso)}
              className={`relative flex flex-col items-center py-1.5 rounded-xl text-sm transition-all
                ${isSelected ? "bg-mykare-600 text-white shadow-md" : ""}
                ${isToday && !isSelected ? "ring-2 ring-mykare-400 text-mykare-700 font-semibold" : ""}
                ${!isSelected && !isToday ? "hover:bg-gray-50 text-gray-700" : ""}
              `}
            >
              <span className="font-medium leading-none">{day}</span>

              {/* Booking indicator dots */}
              {hasBookings && (
                <div className="flex gap-0.5 mt-1">
                  {confirmed.length > 0 && (
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : "bg-green-500"}`} />
                  )}
                  {cancelled.length > 0 && (
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white/70" : "bg-red-400"}`} />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-50 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />Confirmed</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" />Cancelled</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full ring-2 ring-mykare-400 bg-white" />Today</span>
      </div>
    </div>
  );
}

// ── Day Detail Panel ──────────────────────────────────────────────────────────

function DayDetail({ date, appointments }: { date: string; appointments: Appointment[] }) {
  const byTime = new Map<string, Appointment>();
  for (const a of appointments) byTime.set(a.time_slot, a);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-mykare-600" />
        <h3 className="font-semibold text-gray-900 text-sm">{formatDate(date)}</h3>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
          {appointments.filter(a => a.status === "confirmed").length} booked
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {SLOT_TIMES.map(slot => {
          const appt = byTime.get(slot);
          if (appt) {
            return (
              <div
                key={slot}
                className={`rounded-xl px-4 py-3 border flex items-start gap-3 ${
                  appt.status === "confirmed"
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}
              >
                <div className="flex-shrink-0 text-xs font-mono font-semibold text-gray-600 pt-0.5 w-16">
                  {formatTime(slot)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900">{appt.patient_name || "Unknown"}</span>
                    <StatusBadge status={appt.status} />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{appt.intent || "General consultation"}</p>
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
                    <Phone className="w-3 h-3" />
                    {appt.patient_phone}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={slot} className="rounded-xl px-4 py-3 border border-dashed border-gray-200 flex items-center gap-3">
              <span className="text-xs font-mono font-semibold text-gray-400 w-16">{formatTime(slot)}</span>
              <span className="text-xs text-gray-300 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Available
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [filter, setFilter] = useState<"all" | "confirmed" | "cancelled">("all");
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const adminEsRef = useRef<EventSource | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [apptRes, statsRes] = await Promise.all([
        fetch("/api/admin/appointments"),
        fetch("/api/admin/stats"),
      ]);
      const apptData = await apptRes.json();
      const statsData = await statsRes.json();
      setAppointments(apptData.appointments);
      setStats(statsData);
      setLastRefreshed(new Date());
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const es = new EventSource("/api/admin/stream");
    adminEsRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === "db_update") fetchData();
      } catch { /* ignore */ }
    };
    const interval = setInterval(fetchData, 30000);
    return () => { clearInterval(interval); es.close(); };
  }, [fetchData]);

  const filtered = appointments.filter((a) => {
    const matchesFilter = filter === "all" || a.status === filter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      (a.patient_name ?? "").toLowerCase().includes(q) ||
      (a.patient_phone ?? "").includes(q) ||
      (a.intent ?? "").toLowerCase().includes(q) ||
      a.date.includes(q);
    return matchesFilter && matchesSearch;
  });

  const selectedDayAppts = selectedDate
    ? appointments.filter(a => a.date === selectedDate)
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Confirmed",   value: stats?.confirmed   ?? "—", icon: CalendarCheck, color: "text-green-600",  bg: "bg-green-50"  },
          { label: "Cancelled",   value: stats?.cancelled   ?? "—", icon: XCircle,       color: "text-red-500",    bg: "bg-red-50"    },
          { label: "Patients",    value: stats?.patients    ?? "—", icon: Users,          color: "text-blue-600",   bg: "bg-blue-50"   },
          { label: "Total Calls", value: stats?.total_calls ?? "—", icon: PhoneCall,      color: "text-purple-600", bg: "bg-purple-50" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Calendar + Day detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CalendarView
          appointments={appointments}
          selectedDate={selectedDate}
          onSelectDate={(d) => setSelectedDate(prev => prev === d ? null : d)}
        />

        {selectedDate ? (
          <DayDetail date={selectedDate} appointments={selectedDayAppts} />
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-dashed border-gray-200 flex flex-col items-center justify-center gap-3 p-10 text-gray-400">
            <Calendar className="w-8 h-8 text-gray-300" />
            <p className="text-sm">Click a date to see bookings</p>
          </div>
        )}
      </div>

      {/* Appointments table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-900">All Appointments</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {filtered.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search name, phone, intent…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-mykare-300"
            />
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {(["all", "confirmed", "cancelled"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    filter === f ? "bg-mykare-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <button
              onClick={fetchData}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
            <Calendar className="w-10 h-10" />
            <p className="text-sm">No appointments found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">Patient</th>
                  <th className="px-5 py-3 font-medium">Phone</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Intent</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Booked At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((a) => (
                  <tr
                    key={a.id}
                    className={`hover:bg-gray-50 transition-colors cursor-pointer ${
                      selectedDate === a.date ? "bg-mykare-50" : ""
                    }`}
                    onClick={() => setSelectedDate(a.date)}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-mykare-100 flex items-center justify-center flex-shrink-0">
                          <User className="w-3.5 h-3.5 text-mykare-600" />
                        </div>
                        <span className="font-medium text-gray-900">
                          {a.patient_name || <span className="text-gray-400 italic">Unknown</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 text-gray-600">
                        <Phone className="w-3 h-3 text-gray-400" />
                        {a.patient_phone}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 text-gray-700">
                        <Calendar className="w-3 h-3 text-gray-400" />
                        {formatDate(a.date)}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 text-gray-700">
                        <Clock className="w-3 h-3 text-gray-400" />
                        {formatTime(a.time_slot)}
                      </div>
                    </td>
                    <td className="px-5 py-3 max-w-[180px]">
                      <div className="flex items-center gap-1.5 text-gray-600 truncate">
                        <FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span className="truncate">{a.intent || "—"}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {new Date(a.created_at).toLocaleString("en-IN", {
                        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {lastRefreshed && (
          <div className="px-5 py-3 border-t border-gray-50 text-xs text-gray-400">
            Last updated: {lastRefreshed.toLocaleTimeString("en-IN")} · Live updates via SSE
          </div>
        )}
      </div>
    </div>
  );
}
