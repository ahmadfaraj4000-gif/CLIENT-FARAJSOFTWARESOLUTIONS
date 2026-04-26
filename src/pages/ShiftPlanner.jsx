import React, { useEffect, useMemo, useState } from "react";
import "./ShiftPlanner.css";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const EMP_COLORS = [
  { bg: "#1a3a2a", fg: "#2ecc71" },
  { bg: "#1a2a3a", fg: "#22d3c5" },
  { bg: "#2a1a3a", fg: "#9b59b6" },
  { bg: "#3a2a3a", fg: "#9b59b6" },
  { bg: "#3a2a1a", fg: "#f39c12" },
  { bg: "#2a1a1a", fg: "#e74c3c" },
  { bg: "#1a2a1a", fg: "#27ae60" },
  { bg: "#1a1a3a", fg: "#3498db" },
];

const emptyState = {
  employees: [],
  shifts: {},
  weekOffset: 0,
  revenueMode: "daily",
  dailyRevenue: ["", "", "", "", "", "", ""],
  weeklyRevenue: "",
  coverage: ["", "", "", "", "", "", ""],
  currentScheduleName: "",
};

function money(value) {
  return "$" + Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function num(value) {
  const n = parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function keyFor(empId, dayIdx) {
  return `${empId}-${dayIdx}`;
}

function colorFor(emp) {
  return EMP_COLORS[(emp.color_idx || 0) % EMP_COLORS.length];
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return String(name || "??").slice(0, 2).toUpperCase();
}

function shiftHours(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(eh)) return 0;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 1440;
  return mins / 60;
}

function weekMonday(offset = 0) {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - day + offset * 7);
  return d;
}

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function weekLabel(weekOffset) {
  const mon = weekMonday(weekOffset);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return `${fmtDate(mon)} – ${fmtDate(sun)}, ${sun.getFullYear()}`;
}

function normalizePlannerState(data) {
  if (!data) return emptyState;
  return {
    ...emptyState,
    ...data,
    employees: Array.isArray(data.employees) ? data.employees : [],
    shifts: data.shifts && typeof data.shifts === "object" ? data.shifts : {},
    dailyRevenue: Array.isArray(data.dailyRevenue) ? data.dailyRevenue : emptyState.dailyRevenue,
    coverage: Array.isArray(data.coverage) ? data.coverage : emptyState.coverage,
  };
}

export default function ShiftPlanner({ user, supabase }) {
  const [state, setState] = useState(emptyState);
  const [savedSchedules, setSavedSchedules] = useState([]);
  const [activeScheduleId, setActiveScheduleId] = useState(null);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const [employeeForm, setEmployeeForm] = useState({
    name: "",
    role: "",
    wage: "",
    max: "40",
  });

  const [shiftModal, setShiftModal] = useState(null);
  const [employeeModal, setEmployeeModal] = useState(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleName, setScheduleName] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    loadSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function loadSchedules() {
    setLoadingData(true);
    setStatusMessage("");

    const { data, error } = await supabase
      .from("shift_planner_schedules")
      .select("id, user_id, name, week_label, schedule_data, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error(error);
      setStatusMessage("Could not load your schedules. Check Supabase table/RLS setup.");
      setLoadingData(false);
      return;
    }

    setSavedSchedules(data || []);

    if (data && data.length > 0) {
      const first = data[0];
      setActiveScheduleId(first.id);
      setScheduleName(first.name || "");
      setState(normalizePlannerState(first.schedule_data));
    } else {
      setActiveScheduleId(null);
      setScheduleName("");
      setState(emptyState);
    }

    setLoadingData(false);
  }

  async function saveCurrentSchedule(nameOverride) {
    if (!user?.id) {
      setStatusMessage("You must be logged in to save schedules.");
      return;
    }

    const finalName =
      (nameOverride || scheduleName || state.currentScheduleName || `Schedule ${new Date().toLocaleDateString()}`).trim();

    if (!finalName) {
      alert("Enter a schedule name.");
      return;
    }

    setSaving(true);
    setStatusMessage("");

    const nextState = {
      ...state,
      currentScheduleName: finalName,
    };

    const payload = {
      user_id: user.id,
      name: finalName,
      week_label: weekLabel(state.weekOffset),
      schedule_data: nextState,
      updated_at: new Date().toISOString(),
    };

    let result;

    if (activeScheduleId) {
      result = await supabase
        .from("shift_planner_schedules")
        .update(payload)
        .eq("id", activeScheduleId)
        .eq("user_id", user.id)
        .select("id, user_id, name, week_label, schedule_data, created_at, updated_at")
        .single();
    } else {
      result = await supabase
        .from("shift_planner_schedules")
        .insert(payload)
        .select("id, user_id, name, week_label, schedule_data, created_at, updated_at")
        .single();
    }

    if (result.error) {
      console.error(result.error);
      setStatusMessage("Could not save schedule. Check Supabase policies and table columns.");
      setSaving(false);
      return;
    }

    setActiveScheduleId(result.data.id);
    setState(normalizePlannerState(result.data.schedule_data));
    setScheduleName(result.data.name);
    setStatusMessage("Saved to your account.");
    await loadSchedules();
    setSaving(false);
  }

  async function createNewSchedule() {
    setActiveScheduleId(null);
    setScheduleName(`Schedule ${new Date().toLocaleDateString()}`);
    setState(emptyState);
    setScheduleModalOpen(false);
    setStatusMessage("New schedule started. Press Save Schedule to store it.");
  }

  async function openSchedule(schedule) {
    setActiveScheduleId(schedule.id);
    setScheduleName(schedule.name || "");
    setState(normalizePlannerState(schedule.schedule_data));
    setScheduleModalOpen(false);
    setStatusMessage(`Opened ${schedule.name}.`);
  }

  async function deleteSchedule(schedule) {
    if (!confirm(`Delete ${schedule.name}?`)) return;

    const { error } = await supabase
      .from("shift_planner_schedules")
      .delete()
      .eq("id", schedule.id)
      .eq("user_id", user.id);

    if (error) {
      console.error(error);
      setStatusMessage("Could not delete schedule.");
      return;
    }

    await loadSchedules();
  }

  const effectiveDayRevenue = useMemo(() => {
    if (state.revenueMode === "weekly") {
      const wk = num(state.weeklyRevenue);
      return Array(7).fill(wk ? wk / 7 : 0);
    }
    return state.dailyRevenue.map(num);
  }, [state.revenueMode, state.weeklyRevenue, state.dailyRevenue]);

  const effectiveWeekRevenue = useMemo(() => {
    return state.revenueMode === "weekly"
      ? num(state.weeklyRevenue)
      : state.dailyRevenue.reduce((sum, value) => sum + num(value), 0);
  }, [state.revenueMode, state.weeklyRevenue, state.dailyRevenue]);

  const metrics = useMemo(() => {
    const dayCosts = Array(7).fill(0);
    const dayCounts = Array(7).fill(0);
    let totalHours = 0;
    let shiftCount = 0;

    Object.values(state.shifts).forEach((shift) => {
      const emp = state.employees.find((e) => e.emp_id === shift.emp_id);
      if (!emp) return;
      const hrs = shiftHours(shift.start, shift.end);
      dayCosts[shift.day_idx] += hrs * emp.wage;
      dayCounts[shift.day_idx] += 1;
      totalHours += hrs;
      shiftCount += 1;
    });

    const totalCost = dayCosts.reduce((a, b) => a + b, 0);
    const avg = totalCost / 7;
    const peakIdx = dayCosts.indexOf(Math.max(...dayCosts));
    const over = dayCosts.filter((c, i) => effectiveDayRevenue[i] > 0 && c > effectiveDayRevenue[i] * 0.3).length;

    return { dayCosts, dayCounts, totalHours, shiftCount, totalCost, avg, peakIdx, over };
  }, [state.shifts, state.employees, effectiveDayRevenue]);

  const tips = useMemo(() => {
    const out = [];
    if (!state.employees.length) out.push("Add employees and shifts to see suggestions.");

    state.employees.forEach((emp) => {
      const empShifts = Object.values(state.shifts).filter((s) => s.emp_id === emp.emp_id);
      const hrs = empShifts.reduce((sum, s) => sum + shiftHours(s.start, s.end), 0);

      if (empShifts.length === 7) out.push(`📅 ${emp.name} is scheduled 7 days — consider a rest day`);
      if (hrs > (emp.max_hours || 40)) {
        out.push(`⚠️ ${emp.name} is over max hours by ${(hrs - (emp.max_hours || 40)).toFixed(1)}h`);
      }
    });

    metrics.dayCounts.forEach((count, i) => {
      const target = num(state.coverage[i]);
      if (target && count < target) out.push(`👥 ${DAYS[i]} is under coverage by ${target - count} staff`);
      if (effectiveDayRevenue[i] && metrics.dayCosts[i] > effectiveDayRevenue[i] * 0.3) {
        out.push(`💸 ${DAYS[i]} labor is above 30% of revenue`);
      }
    });

    if (effectiveWeekRevenue && metrics.totalCost / effectiveWeekRevenue < 0.18 && metrics.shiftCount) {
      out.push("✅ Labor percentage is currently lean. Double-check coverage before cutting more hours.");
    }

    if (!out.length) out.push("✅ Schedule looks balanced based on current revenue and coverage inputs.");
    return out.slice(0, 8);
  }, [state.employees, state.shifts, state.coverage, effectiveDayRevenue, effectiveWeekRevenue, metrics]);

  function addEmployee() {
    const name = employeeForm.name.trim();
    const role = employeeForm.role.trim();
    const wage = num(employeeForm.wage);
    const max = num(employeeForm.max) || 40;

    if (!name) return alert("Name is required.");
    if (wage <= 0) return alert("Enter a valid hourly wage.");

    const nextId = state.employees.reduce((m, e) => Math.max(m, e.emp_id), 0) + 1;

    setState((prev) => ({
      ...prev,
      employees: [
        ...prev.employees,
        {
          emp_id: nextId,
          name,
          role,
          wage,
          max_hours: max,
          color_idx: prev.employees.length,
          unavailable_days: [],
        },
      ],
    }));

    setEmployeeForm({ name: "", role: "", wage: "", max: "40" });
    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }

  function deleteEmployee(id) {
    const emp = state.employees.find((e) => e.emp_id === id);
    if (!emp) return;
    if (!confirm(`Remove ${emp.name} and all their shifts?`)) return;

    setState((prev) => {
      const shifts = { ...prev.shifts };
      Object.keys(shifts).forEach((k) => {
        if (shifts[k].emp_id === id) delete shifts[k];
      });

      return {
        ...prev,
        employees: prev.employees.filter((e) => e.emp_id !== id),
        shifts,
      };
    });
    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }

  function openShift(empId, dayIdx) {
    const emp = state.employees.find((e) => e.emp_id === empId);
    if (!emp) return;

    if ((emp.unavailable_days || []).includes(dayIdx)) {
      alert(`${emp.name} is marked unavailable on ${DAYS[dayIdx]}.`);
      return;
    }

    const existing = state.shifts[keyFor(empId, dayIdx)];
    setShiftModal({
      empId,
      dayIdx,
      start: existing?.start || "09:00",
      end: existing?.end || "17:00",
    });
  }

  function saveShift() {
    if (!shiftModal) return;
    const emp = state.employees.find((e) => e.emp_id === shiftModal.empId);
    if (!emp) return;

    const proposed = shiftHours(shiftModal.start, shiftModal.end);
    const existingKey = keyFor(emp.emp_id, shiftModal.dayIdx);
    const currentHours = Object.entries(state.shifts).reduce((sum, [k, s]) => {
      return sum + (s.emp_id === emp.emp_id && k !== existingKey ? shiftHours(s.start, s.end) : 0);
    }, 0);

    if (
      currentHours + proposed > (emp.max_hours || 40) + 0.01 &&
      !confirm(
        `This puts ${emp.name} at ${(currentHours + proposed).toFixed(1)}h, over their max of ${(emp.max_hours || 40).toFixed(1)}h. Save anyway?`
      )
    ) {
      return;
    }

    setState((prev) => ({
      ...prev,
      shifts: {
        ...prev.shifts,
        [existingKey]: {
          emp_id: emp.emp_id,
          day_idx: shiftModal.dayIdx,
          start: shiftModal.start,
          end: shiftModal.end,
        },
      },
    }));

    setShiftModal(null);
    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }

  function deleteShift() {
    if (!shiftModal) return;
    setState((prev) => {
      const shifts = { ...prev.shifts };
      delete shifts[keyFor(shiftModal.empId, shiftModal.dayIdx)];
      return { ...prev, shifts };
    });
    setShiftModal(null);
    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }

  function openEmployee(emp) {
    setEmployeeModal({
      emp_id: emp.emp_id,
      name: emp.name,
      role: emp.role || "",
      wage: String(emp.wage),
      max_hours: String(emp.max_hours || 40),
      unavailable_days: [...(emp.unavailable_days || [])],
    });
  }

  function saveEmployeeEdit() {
    if (!employeeModal) return;
    const name = employeeModal.name.trim();
    const wage = num(employeeModal.wage);
    const max = num(employeeModal.max_hours) || 40;

    if (!name) return alert("Name is required.");
    if (wage <= 0) return alert("Enter a valid wage.");

    setState((prev) => {
      const employees = prev.employees.map((emp) =>
        emp.emp_id === employeeModal.emp_id
          ? {
              ...emp,
              name,
              role: employeeModal.role.trim(),
              wage,
              max_hours: max,
              unavailable_days: employeeModal.unavailable_days,
            }
          : emp
      );

      const shifts = { ...prev.shifts };
      Object.keys(shifts).forEach((k) => {
        const s = shifts[k];
        if (s.emp_id === employeeModal.emp_id && employeeModal.unavailable_days.includes(s.day_idx)) {
          delete shifts[k];
        }
      });

      return { ...prev, employees, shifts };
    });

    setEmployeeModal(null);
    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }

  function updateDailyRevenue(index, value) {
    setState((prev) => {
      const dailyRevenue = [...prev.dailyRevenue];
      dailyRevenue[index] = value;
      return { ...prev, dailyRevenue };
    });
    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }

  function updateCoverage(index, value) {
    setState((prev) => {
      const coverage = [...prev.coverage];
      coverage[index] = value;
      return { ...prev, coverage };
    });
    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }

  function exportCsv() {
    const rows = [["Employee", "Role", "Hourly Wage", "Max Hours", ...DAYS, "Total Hours", "Total Cost"]];

    state.employees.forEach((emp) => {
      let totalH = 0;
      let totalC = 0;

      const cells = DAYS.map((_, i) => {
        const shift = state.shifts[keyFor(emp.emp_id, i)];
        if (!shift) return "";
        const hrs = shiftHours(shift.start, shift.end);
        const cost = hrs * emp.wage;
        totalH += hrs;
        totalC += cost;
        return `${shift.start}-${shift.end} (${hrs.toFixed(1)}h, ${money(cost)})`;
      });

      rows.push([emp.name, emp.role || "", emp.wage, emp.max_hours || 40, ...cells, totalH.toFixed(1), totalC.toFixed(2)]);
    });

    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (state.currentScheduleName || "shift-planner-schedule").replace(/[^a-z0-9_-]+/gi, "_") + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearWeek() {
    if (!confirm("Clear all shifts for this week? Employees and inputs stay.")) return;
    setState((prev) => ({ ...prev, shifts: {} }));
    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }

  const modalEmp = shiftModal ? state.employees.find((e) => e.emp_id === shiftModal.empId) : null;
  const existingShift = shiftModal ? state.shifts[keyFor(shiftModal.empId, shiftModal.dayIdx)] : null;

  if (loadingData) {
    return (
      <main className="planner-wrap">
        <div className="shift-planner-wide">
          <div className="planner-shell loading-shell">Loading your Shift Planner account...</div>
        </div>
      </main>
    );
  }

  return (
    <main className="planner-wrap">
      <div className="shift-planner-wide">
        <section className="planner-shell" aria-labelledby="plannerTitle">
          <div className="planner-hero">
            <div>
              <div className="demo-eyebrow">Client Portal App</div>
              <h1 id="plannerTitle">
                Shift Planner <span className="accent">for labor cost control</span>
              </h1>
              <p>
                Your employees, shifts, revenue targets, and saved schedules are stored securely under your logged-in account.
              </p>
              {statusMessage && <div className="portal-status">{statusMessage}</div>}
            </div>

            <div className="planner-actions">
              <button className="small-btn primary" type="button" onClick={() => saveCurrentSchedule()} disabled={saving}>
                {saving ? "Saving..." : "💾 Save Schedule"}
              </button>
              <button
                className="small-btn"
                type="button"
                onClick={() => {
                  setScheduleName(state.currentScheduleName || "");
                  setScheduleModalOpen(true);
                }}
              >
                📅 Schedule Manager
              </button>
              <button className="small-btn" type="button" onClick={createNewSchedule}>
                New Schedule
              </button>
              <button className="small-btn" type="button" onClick={exportCsv}>
                Export CSV
              </button>
              <button className="small-btn danger" type="button" onClick={clearWeek}>
                Clear Week
              </button>
            </div>
          </div>

          <div className="planner-app">
            <aside className="planner-sidebar">
              <div className="mini-label">Add Employee</div>
              <div className="planner-card">
                <input
                  className="field"
                  value={employeeForm.name}
                  onChange={(e) => setEmployeeForm((p) => ({ ...p, name: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                  type="text"
                  placeholder="Full Name *"
                />
                <div className="spacer-9" />
                <input
                  className="field"
                  value={employeeForm.role}
                  onChange={(e) => setEmployeeForm((p) => ({ ...p, role: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                  type="text"
                  placeholder="Role / Title"
                />
                <div className="spacer-9" />
                <div className="field-row">
                  <input
                    className="field"
                    value={employeeForm.wage}
                    onChange={(e) => setEmployeeForm((p) => ({ ...p, wage: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Hourly Wage *"
                  />
                  <input
                    className="field"
                    value={employeeForm.max}
                    onChange={(e) => setEmployeeForm((p) => ({ ...p, max: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                    type="number"
                    min="1"
                    step="0.5"
                    placeholder="Max Hours"
                  />
                </div>
                <div className="spacer-10" />
                <button className="small-btn primary full-width" type="button" onClick={addEmployee}>
                  ＋ Add Employee
                </button>
              </div>

              <div className="mini-label">Employees</div>
              <div className="emp-list">
                {state.employees.length ? (
                  state.employees.map((emp) => {
                    const color = colorFor(emp);
                    const hrs = Object.values(state.shifts)
                      .filter((s) => s.emp_id === emp.emp_id)
                      .reduce((sum, s) => sum + shiftHours(s.start, s.end), 0);

                    return (
                      <div className="emp-card" key={emp.emp_id}>
                        <div className="emp-dot" style={{ color: color.fg, background: color.bg }}>
                          {initials(emp.name)}
                        </div>
                        <div>
                          <div className="emp-name">{emp.name}</div>
                          <div className="emp-meta">
                            {emp.role || "No role"} · {money(emp.wage)}/hr · {hrs.toFixed(1)}/
                            {(emp.max_hours || 40).toFixed(1)}h
                          </div>
                        </div>
                        <div className="emp-tools">
                          <button className="icon-btn" type="button" title="Edit" onClick={() => openEmployee(emp)}>
                            ✎
                          </button>
                          <button className="icon-btn" type="button" title="Delete" onClick={() => deleteEmployee(emp.emp_id)}>
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="planner-card empty-text">Add employees to build the weekly schedule.</div>
                )}
              </div>

              <div className="mini-label">Projected Revenue</div>
              <div className="planner-card">
                <label className="checkbox-label">
                  <input
                    checked={state.revenueMode === "weekly"}
                    onChange={(e) => {
                      setState((p) => ({ ...p, revenueMode: e.target.checked ? "weekly" : "daily" }));
                      setStatusMessage("Unsaved changes. Press Save Schedule.");
                    }}
                    type="checkbox"
                  />
                  Use weekly revenue only
                </label>

                <div className="revenue-grid">
                  {DAYS.map((day, i) => (
                    <label className="day-input" key={day}>
                      <span>{day}</span>
                      <input
                        className="field"
                        value={state.dailyRevenue[i] || ""}
                        onChange={(e) => updateDailyRevenue(i, e.target.value)}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                      />
                    </label>
                  ))}
                </div>

                <div className="spacer-9" />
                <div className="day-input">
                  <span>Week</span>
                  <input
                    className="field"
                    value={state.weeklyRevenue || ""}
                    onChange={(e) => {
                      setState((p) => ({ ...p, weeklyRevenue: e.target.value }));
                      setStatusMessage("Unsaved changes. Press Save Schedule.");
                    }}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="mini-label">Coverage Targets</div>
              <div className="planner-card">
                <p className="subtle-text">Minimum staff needed per day.</p>
                <div className="coverage-grid">
                  {DAYS.map((day, i) => (
                    <label className="day-input" key={day}>
                      <span>{day}</span>
                      <input
                        className="field"
                        value={state.coverage[i] || ""}
                        onChange={(e) => updateCoverage(i, e.target.value)}
                        type="number"
                        min="0"
                        step="1"
                        placeholder="—"
                      />
                    </label>
                  ))}
                </div>
                <div className="labor-pct">
                  {effectiveWeekRevenue > 0 ? `${((metrics.totalCost / effectiveWeekRevenue) * 100).toFixed(1)}%` : "—"}
                </div>
                <div className="labor-caption">LABOR % OF WEEKLY REVENUE</div>
              </div>
            </aside>

            <section className="planner-main">
              <div className="week-bar">
                <div className="week-left">
                  <button className="small-btn" type="button" onClick={() => setState((p) => ({ ...p, weekOffset: p.weekOffset - 1 }))}>
                    ‹
                  </button>
                  <div className="week-title">{weekLabel(state.weekOffset)}</div>
                  <button className="small-btn" type="button" onClick={() => setState((p) => ({ ...p, weekOffset: p.weekOffset + 1 }))}>
                    ›
                  </button>
                  <button className="small-btn" type="button" onClick={() => setState((p) => ({ ...p, weekOffset: 0 }))}>
                    Today
                  </button>
                </div>
                <div className="week-right">
                  <span className="schedule-status">{state.currentScheduleName ? `Loaded: ${state.currentScheduleName}` : "No schedule loaded"}</span>
                </div>
              </div>

              <div className="stats-grid">
                <div className="stat-card"><span>Total Labor Cost</span><strong>{money(metrics.totalCost)}</strong></div>
                <div className="stat-card"><span>Total Hours</span><strong>{metrics.totalHours.toFixed(1)}h</strong></div>
                <div className="stat-card"><span>Avg Cost / Day</span><strong>{money(metrics.avg)}</strong></div>
                <div className="stat-card"><span>Highest Day</span><strong>{metrics.totalCost ? `${DAYS[metrics.peakIdx]} ${money(metrics.dayCosts[metrics.peakIdx])}` : "—"}</strong></div>
                <div className="stat-card"><span>Shifts Scheduled</span><strong>{metrics.shiftCount}</strong></div>
                <div className="stat-card"><span>Over Budget Days</span><strong>{metrics.over}</strong></div>
              </div>

              <div className="grid-wrap">
                <div className="schedule-grid">
                  <div className="emp-head-cell">Employee</div>
                  {DAYS.map((day, i) => {
                    const date = new Date(weekMonday(state.weekOffset));
                    date.setDate(date.getDate() + i);
                    return (
                      <div className="grid-head" key={day}>
                        {day}<br /><span>{fmtDate(date)}</span>
                      </div>
                    );
                  })}

                  {state.employees.map((emp) => {
                    const color = colorFor(emp);

                    return (
                      <React.Fragment key={emp.emp_id}>
                        <div className="emp-row-label">
                          <div className="emp-dot small-dot" style={{ color: color.fg, background: color.bg }}>
                            {initials(emp.name)}
                          </div>
                          <div>
                            <div className="emp-name">{emp.name}</div>
                            <div className="emp-meta">{emp.role || "Employee"}</div>
                          </div>
                        </div>

                        {DAYS.map((_, i) => {
                          const shift = state.shifts[keyFor(emp.emp_id, i)];
                          const unavailable = (emp.unavailable_days || []).includes(i);
                          const hrs = shift ? shiftHours(shift.start, shift.end) : 0;
                          const cost = hrs * emp.wage;

                          return (
                            <div className="grid-cell" key={`${emp.emp_id}-${i}`}>
                              {unavailable ? (
                                <div className="unavailable">Unavailable</div>
                              ) : shift ? (
                                <button
                                  className="shift-card"
                                  type="button"
                                  style={{ color: color.fg, background: color.bg }}
                                  onClick={() => openShift(emp.emp_id, i)}
                                >
                                  <div className="shift-time">{shift.start} – {shift.end}</div>
                                  <div className="shift-hours">{hrs.toFixed(1)}h</div>
                                  <div className="shift-cost">{money(cost)}</div>
                                </button>
                              ) : (
                                <button className="shift-empty" type="button" onClick={() => openShift(emp.emp_id, i)}>
                                  +
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              <div className="suggestions">
                <div className="suggestions-title">💡 Smart scheduling suggestions</div>
                <div className="tip-row">
                  {tips.map((tip, index) => <span className="tip" key={`${tip}-${index}`}>{tip}</span>)}
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>

      {shiftModal && modalEmp && (
        <div className="modal-backdrop open" onClick={() => setShiftModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{existingShift ? "Edit Shift" : "Add Shift"}</h3>
            <p>
              {modalEmp.name} · {DAYS[shiftModal.dayIdx]} · {money(modalEmp.wage)}/hr · Max{" "}
              {(modalEmp.max_hours || 40).toFixed(1)}h
            </p>

            <div className="field-row">
              <input className="field" value={shiftModal.start} onChange={(e) => setShiftModal((p) => ({ ...p, start: e.target.value }))} type="time" />
              <input className="field" value={shiftModal.end} onChange={(e) => setShiftModal((p) => ({ ...p, end: e.target.value }))} type="time" />
            </div>

            <div className="spacer-10" />
            <div className="planner-card">
              {shiftHours(shiftModal.start, shiftModal.end).toFixed(1)} hrs ·{" "}
              {money(shiftHours(shiftModal.start, shiftModal.end) * modalEmp.wage)} labor cost
            </div>

            <div className="spacer-14" />
            <div className="button-row right-buttons">
              {existingShift && <button className="small-btn danger" type="button" onClick={deleteShift}>Delete Shift</button>}
              <button className="small-btn" type="button" onClick={() => setShiftModal(null)}>Cancel</button>
              <button className="small-btn primary" type="button" onClick={saveShift}>Save Shift</button>
            </div>
          </div>
        </div>
      )}

      {employeeModal && (
        <div className="modal-backdrop open" onClick={() => setEmployeeModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Employee</h3>

            <div className="field-row">
              <input className="field" value={employeeModal.name} onChange={(e) => setEmployeeModal((p) => ({ ...p, name: e.target.value }))} type="text" placeholder="Name" />
              <input className="field" value={employeeModal.role} onChange={(e) => setEmployeeModal((p) => ({ ...p, role: e.target.value }))} type="text" placeholder="Role" />
            </div>

            <div className="spacer-9" />

            <div className="field-row">
              <input className="field" value={employeeModal.wage} onChange={(e) => setEmployeeModal((p) => ({ ...p, wage: e.target.value }))} type="number" min="0" step="0.01" placeholder="Wage" />
              <input className="field" value={employeeModal.max_hours} onChange={(e) => setEmployeeModal((p) => ({ ...p, max_hours: e.target.value }))} type="number" min="1" step="0.5" placeholder="Max hours" />
            </div>

            <p className="modal-section-title">Unavailable days</p>

            <div className="check-grid">
              {DAYS.map((day, i) => (
                <button
                  type="button"
                  className={`check-day ${employeeModal.unavailable_days.includes(i) ? "active" : ""}`}
                  key={day}
                  onClick={() =>
                    setEmployeeModal((p) => ({
                      ...p,
                      unavailable_days: p.unavailable_days.includes(i)
                        ? p.unavailable_days.filter((d) => d !== i)
                        : [...p.unavailable_days, i],
                    }))
                  }
                >
                  {day}
                </button>
              ))}
            </div>

            <div className="button-row right-buttons">
              <button className="small-btn" type="button" onClick={() => setEmployeeModal(null)}>Cancel</button>
              <button className="small-btn primary" type="button" onClick={saveEmployeeEdit}>Save Employee</button>
            </div>
          </div>
        </div>
      )}

      {scheduleModalOpen && (
        <div className="modal-backdrop open" onClick={() => setScheduleModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Schedule Manager</h3>
            <p>These schedules are saved to Supabase under your logged-in account.</p>

            <div className="field-row">
              <input className="field" value={scheduleName} onChange={(e) => setScheduleName(e.target.value)} type="text" placeholder="Schedule name" />
              <button className="small-btn primary" type="button" onClick={() => saveCurrentSchedule()}>Save Current</button>
            </div>

            <div className="spacer-14" />

            <div className="saved-list">
              {savedSchedules.length ? (
                savedSchedules.map((schedule) => (
                  <div className="saved-item" key={schedule.id}>
                    <div>
                      <strong>{schedule.name}</strong>
                      <span>{schedule.week_label || "Saved schedule"}</span>
                    </div>
                    <div className="button-row">
                      <button className="small-btn success" type="button" onClick={() => openSchedule(schedule)}>Open</button>
                      <button className="small-btn danger" type="button" onClick={() => deleteSchedule(schedule)}>Delete</button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="planner-card empty-text">No saved schedules yet.</div>
              )}
            </div>

            <div className="spacer-14" />

            <div className="button-row right-buttons">
              <button className="small-btn" type="button" onClick={() => setScheduleModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
