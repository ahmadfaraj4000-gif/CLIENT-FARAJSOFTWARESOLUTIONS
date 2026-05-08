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

const DEFAULT_SETTINGS = {
  targetLaborPercent: 35,
  cautionLaborPercent: 28,
  dangerLaborPercent: 35,
  overtimeThreshold: 40,
  minimumStaffPerShift: 2,
  businessType: "General Service",
  openingTime: "08:00",
  closingTime: "21:00",
  maxConsecutiveDays: 6,
  preferredStrategy: "Balanced",
  busyDays: [4, 5],
  weeklyBudget: "",
};

const BUSINESS_TYPES = [
  "Restaurant",
  "Retail",
  "Auto Shop",
  "Salon / Spa",
  "Rental Business",
  "General Service",
  "Custom",
];

const LABOR_STRATEGIES = [
  "Balanced",
  "Lean Labor",
  "High Service Coverage",
  "Aggressive Cost Saving",
];

function normalizeSettings(data) {
  if (!data) return DEFAULT_SETTINGS;

  return {
    targetLaborPercent: Number(data.target_labor_percent ?? data.targetLaborPercent ?? DEFAULT_SETTINGS.targetLaborPercent),
    cautionLaborPercent: Number(data.caution_labor_percent ?? data.cautionLaborPercent ?? DEFAULT_SETTINGS.cautionLaborPercent),
    dangerLaborPercent: Number(data.danger_labor_percent ?? data.dangerLaborPercent ?? DEFAULT_SETTINGS.dangerLaborPercent),
    overtimeThreshold: Number(data.overtime_threshold ?? data.overtimeThreshold ?? DEFAULT_SETTINGS.overtimeThreshold),
    minimumStaffPerShift: Number(data.minimum_staff_per_shift ?? data.minimumStaffPerShift ?? DEFAULT_SETTINGS.minimumStaffPerShift),
    businessType: data.business_type ?? data.businessType ?? DEFAULT_SETTINGS.businessType,
    openingTime: data.opening_time ?? data.openingTime ?? DEFAULT_SETTINGS.openingTime,
    closingTime: data.closing_time ?? data.closingTime ?? DEFAULT_SETTINGS.closingTime,
    maxConsecutiveDays: Number(data.max_consecutive_days ?? data.maxConsecutiveDays ?? DEFAULT_SETTINGS.maxConsecutiveDays),
    preferredStrategy: data.preferred_strategy ?? data.preferredStrategy ?? DEFAULT_SETTINGS.preferredStrategy,
    busyDays: Array.isArray(data.busy_days ?? data.busyDays) ? (data.busy_days ?? data.busyDays) : DEFAULT_SETTINGS.busyDays,
    weeklyBudget: data.weekly_budget ?? data.weeklyBudget ?? DEFAULT_SETTINGS.weeklyBudget,
  };
}

function settingsToPayload(settings, userId) {
  return {
    user_id: userId,
    target_labor_percent: num(settings.targetLaborPercent) || DEFAULT_SETTINGS.targetLaborPercent,
    caution_labor_percent: num(settings.cautionLaborPercent) || DEFAULT_SETTINGS.cautionLaborPercent,
    danger_labor_percent: num(settings.dangerLaborPercent) || DEFAULT_SETTINGS.dangerLaborPercent,
    overtime_threshold: num(settings.overtimeThreshold) || DEFAULT_SETTINGS.overtimeThreshold,
    minimum_staff_per_shift: num(settings.minimumStaffPerShift) || DEFAULT_SETTINGS.minimumStaffPerShift,
    business_type: settings.businessType || DEFAULT_SETTINGS.businessType,
    opening_time: settings.openingTime || DEFAULT_SETTINGS.openingTime,
    closing_time: settings.closingTime || DEFAULT_SETTINGS.closingTime,
    max_consecutive_days: num(settings.maxConsecutiveDays) || DEFAULT_SETTINGS.maxConsecutiveDays,
    preferred_strategy: settings.preferredStrategy || DEFAULT_SETTINGS.preferredStrategy,
    busy_days: Array.isArray(settings.busyDays) ? settings.busyDays : DEFAULT_SETTINGS.busyDays,
    weekly_budget: settings.weeklyBudget === "" ? null : num(settings.weeklyBudget),
    updated_at: new Date().toISOString(),
  };
}

function timeHour(value) {
  const hour = Number(String(value || "").split(":")[0]);
  return Number.isFinite(hour) ? hour : 0;
}

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
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsForm, setSettingsForm] = useState(DEFAULT_SETTINGS);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsIntroMode, setSettingsIntroMode] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [historyStack, setHistoryStack] = useState([]);
  const [showAllTips, setShowAllTips] = useState(false);

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
    loadPlannerSettings();
    loadSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function loadPlannerSettings() {
    if (!user?.id) return;

    const { data, error } = await supabase
      .from("shift_planner_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error(error);
      setSettings(DEFAULT_SETTINGS);
      setSettingsForm(DEFAULT_SETTINGS);
      setSettingsLoaded(true);
      setSettingsIntroMode(true);
      setSettingsModalOpen(true);
      setStatusMessage("Settings table not found yet. Run the Shift Planner settings SQL, then save settings again.");
      return;
    }

    if (data) {
      const normalized = normalizeSettings(data);
      setSettings(normalized);
      setSettingsForm(normalized);
      setSettingsIntroMode(false);
      setSettingsModalOpen(false);
    } else {
      setSettings(DEFAULT_SETTINGS);
      setSettingsForm(DEFAULT_SETTINGS);
      setSettingsIntroMode(true);
      setSettingsModalOpen(true);
    }

    setSettingsLoaded(true);
  }

  async function savePlannerSettings(event) {
    event?.preventDefault();

    if (!user?.id) {
      setStatusMessage("You must be logged in to save settings.");
      return;
    }

    const normalized = normalizeSettings(settingsForm);

    if (normalized.cautionLaborPercent > normalized.dangerLaborPercent) {
      alert("Caution labor % should be lower than or equal to danger labor %.");
      return;
    }

    const { data, error } = await supabase
      .from("shift_planner_settings")
      .upsert(settingsToPayload(normalized, user.id), { onConflict: "user_id" })
      .select("*")
      .single();

    if (error) {
      console.error(error);
      setStatusMessage("Could not save settings. Run the shift_planner_settings SQL and check RLS policies.");
      return;
    }

    const saved = normalizeSettings(data);
    setSettings(saved);
    setSettingsForm(saved);
    setSettingsIntroMode(false);
    setSettingsModalOpen(false);
    setSettingsLoaded(true);
    setStatusMessage("Settings saved. Tips and labor warnings now use your targets.");
  }

  function openSettingsModal() {
    setSettingsForm(settings);
    setSettingsIntroMode(false);
    setSettingsModalOpen(true);
  }

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
    const dangerLaborPct = (num(settings.dangerLaborPercent) || DEFAULT_SETTINGS.dangerLaborPercent) / 100;
    const over = dayCosts.filter((c, i) => effectiveDayRevenue[i] > 0 && c > effectiveDayRevenue[i] * dangerLaborPct).length;

    return { dayCosts, dayCounts, totalHours, shiftCount, totalCost, avg, peakIdx, over };
  }, [state.shifts, state.employees, effectiveDayRevenue, settings.dangerLaborPercent]);

  const tips = useMemo(() => {
    const out = [];

    const addTip = (priority, type, title, action) => {
      out.push({ priority, type, title, action });
    };

    const shiftEntries = Object.values(state.shifts);
    const targetLaborPct = (num(settings.targetLaborPercent) || DEFAULT_SETTINGS.targetLaborPercent) / 100;
    const cautionLaborPct = (num(settings.cautionLaborPercent) || DEFAULT_SETTINGS.cautionLaborPercent) / 100;
    const dangerLaborPct = (num(settings.dangerLaborPercent) || DEFAULT_SETTINGS.dangerLaborPercent) / 100;
    const overtimeLimit = num(settings.overtimeThreshold) || DEFAULT_SETTINGS.overtimeThreshold;
    const minStaff = num(settings.minimumStaffPerShift) || DEFAULT_SETTINGS.minimumStaffPerShift;
    const maxConsecutiveDays = num(settings.maxConsecutiveDays) || DEFAULT_SETTINGS.maxConsecutiveDays;
    const weeklyBudget = num(settings.weeklyBudget);
    const closingHour = timeHour(settings.closingTime);
    const openingHour = timeHour(settings.openingTime);
    const busyDays = Array.isArray(settings.busyDays) ? settings.busyDays : [];

    if (!state.employees.length) {
      return {
        bestMove: {
          type: "info",
          title: "Add employees to unlock labor guidance",
          action: "Enter employee names, hourly wages, max hours, and availability. Then Shift Planner can flag labor risk, overtime, and coverage gaps.",
        },
        items: [],
        hiddenItems: [],
        hiddenCount: 0,
      };
    }

    const employeeHours = {};
    const employeeShiftCounts = {};
    const employeeLongShiftCounts = {};
    const employeeById = {};

    state.employees.forEach((emp) => {
      employeeById[emp.emp_id] = emp;
      employeeHours[emp.emp_id] = 0;
      employeeShiftCounts[emp.emp_id] = 0;
      employeeLongShiftCounts[emp.emp_id] = 0;
    });

    shiftEntries.forEach((shift) => {
      const emp = employeeById[shift.emp_id];
      if (!emp) return;
      const hrs = shiftHours(shift.start, shift.end);
      employeeHours[emp.emp_id] += hrs;
      employeeShiftCounts[emp.emp_id] += 1;
      if (hrs >= 10) employeeLongShiftCounts[emp.emp_id] += 1;
    });

    state.employees.forEach((emp) => {
      const hrs = employeeHours[emp.emp_id] || 0;
      const shiftCount = employeeShiftCounts[emp.emp_id] || 0;
      const longShiftCount = employeeLongShiftCounts[emp.emp_id] || 0;
      const maxHours = emp.max_hours || overtimeLimit;
      const overMax = hrs - maxHours;
      const overOvertime = hrs - overtimeLimit;

      if (shiftCount > maxConsecutiveDays) {
        addTip(
          90,
          "warning",
          `${emp.name} is scheduled ${shiftCount} days`,
          `Your setting allows ${maxConsecutiveDays} consecutive days. Move one shift to another employee or add a day off to reduce burnout risk.`
        );
      }

      if (overMax > 0) {
        addTip(
          100,
          "critical",
          `${emp.name} is ${overMax.toFixed(1)}h over max hours`,
          `Shorten one shift by ${Math.min(overMax, 4).toFixed(1)}h or move hours to an employee with capacity before saving the schedule.`
        );
      }

      if (overOvertime > 0) {
        addTip(
          96,
          "critical",
          `${emp.name} is above your ${overtimeLimit.toFixed(1)}h overtime threshold`,
          `Review their longest shift first. Reducing ${overOvertime.toFixed(1)}h would bring this employee back under the overtime target.`
        );
      }

      if (shiftCount > 0 && longShiftCount >= 2) {
        addTip(
          72,
          "improve",
          `${emp.name} has ${longShiftCount} long shifts`,
          "Consider splitting one 10+ hour shift or adding coverage during the busiest part of the day to protect service quality."
        );
      }

      if (state.employees.length > 1 && shiftCount > 0 && hrs < 12) {
        addTip(
          45,
          "info",
          `${emp.name} has only ${hrs.toFixed(1)} scheduled hours`,
          "If this is not intentional, use this employee to absorb overtime or high-cost shifts from overloaded team members."
        );
      }
    });

    metrics.dayCounts.forEach((count, i) => {
      const target = num(state.coverage[i]) || minStaff;
      const revenue = effectiveDayRevenue[i] || 0;
      const laborCost = metrics.dayCosts[i] || 0;
      const laborPct = revenue > 0 ? laborCost / revenue : 0;
      const targetLaborDollars = revenue > 0 ? revenue * targetLaborPct : 0;
      const dollarsOverTarget = targetLaborDollars ? laborCost - targetLaborDollars : 0;
      const avgWage = count > 0 ? laborCost / Math.max(shiftEntries.filter((shift) => shift.day_idx === i).reduce((sum, shift) => sum + shiftHours(shift.start, shift.end), 0), 1) : 0;
      const hoursToCut = avgWage > 0 && dollarsOverTarget > 0 ? dollarsOverTarget / avgWage : 0;

      if (target && count < target) {
        addTip(
          95,
          "critical",
          `${DAYS[i]} is under coverage by ${target - count} staff`,
          `Add ${target - count} employee${target - count === 1 ? "" : "s"} or lower the coverage target if demand is expected to be lighter than normal.`
        );
      }

      if (target && count > target + 2 && revenue > 0 && laborPct > cautionLaborPct) {
        addTip(
          82,
          "warning",
          `${DAYS[i]} may be overstaffed`,
          `${count} employees are scheduled vs a target of ${target}. Try removing one shift or shortening one low-priority shift by 2 hours.`
        );
      }

      if (revenue > 0 && count <= 1 && revenue >= effectiveWeekRevenue / 7 * 1.25) {
        addTip(
          86,
          "critical",
          `${DAYS[i]} revenue looks high but coverage is thin`,
          `Only ${count} employee${count === 1 ? "" : "s"} scheduled. Add coverage during peak hours so labor savings do not create service problems.`
        );
      }

      if (revenue > 0 && laborPct >= dangerLaborPct) {
        addTip(
          98,
          "critical",
          `${DAYS[i]} labor is ${(laborPct * 100).toFixed(1)}% of revenue`,
          dollarsOverTarget > 0
            ? `${DAYS[i]} is ${money(dollarsOverTarget)} above your ${settings.targetLaborPercent}% target. Cut about ${hoursToCut.toFixed(1)} labor hours or move coverage to a lower-cost employee.`
            : `This is above your ${settings.dangerLaborPercent}% danger setting. Review shift length and headcount before publishing.`
        );
      } else if (revenue > 0 && laborPct >= cautionLaborPct) {
        addTip(
          78,
          "warning",
          `${DAYS[i]} labor is nearing the danger zone`,
          dollarsOverTarget > 0
            ? `${DAYS[i]} is ${money(dollarsOverTarget)} above target. Shorten one shift or reduce overlap where possible.`
            : `Labor is ${(laborPct * 100).toFixed(1)}% against your ${settings.cautionLaborPercent}% caution setting. Watch this day closely.`
        );
      }

      if (targetLaborDollars && laborCost > targetLaborDollars) {
        addTip(
          74,
          "improve",
          `${DAYS[i]} is ${money(laborCost - targetLaborDollars)} above target labor budget`,
          hoursToCut > 0
            ? `A reduction of roughly ${hoursToCut.toFixed(1)} labor hours would bring this day closer to your ${settings.targetLaborPercent}% target.`
            : `Review this day for unnecessary overlap or shifts that can be shortened.`
        );
      }

      if (busyDays.includes(i) && count < target + 1) {
        addTip(
          88,
          "warning",
          `${DAYS[i]} is marked busy but has minimal extra coverage`,
          `Add one additional shift during peak hours or make sure your strongest employee is scheduled during the rush.`
        );
      }

      if ((i === 5 || i === 6) && count < target) {
        addTip(
          84,
          "warning",
          `${DAYS[i]} weekend coverage is below target`,
          `Weekend demand often needs extra support. Add coverage or confirm projected revenue is low enough to justify lean staffing.`
        );
      }
    });

    state.employees.forEach((emp) => {
      for (let i = 0; i < 6; i += 1) {
        const todayShift = state.shifts[keyFor(emp.emp_id, i)];
        const nextDayShift = state.shifts[keyFor(emp.emp_id, i + 1)];
        if (!todayShift || !nextDayShift) continue;
        const todayEndHour = timeHour(todayShift.end);
        const nextStartHour = timeHour(nextDayShift.start);
        if (todayEndHour >= Math.max(closingHour - 1, 20) && nextStartHour <= Math.max(openingHour + 1, 8)) {
          addTip(
            84,
            "warning",
            `${emp.name} has a close-to-open turnaround`,
            `They close ${DAYS[i]} and open ${DAYS[i + 1]}. Swap one of those shifts to reduce fatigue and missed-start risk.`
          );
        }
      }
    });

    DAYS.forEach((day, i) => {
      const dayShifts = shiftEntries.filter((shift) => shift.day_idx === i);
      const hasManager = dayShifts.some((shift) => /manager|supervisor|lead|owner|admin/i.test(employeeById[shift.emp_id]?.role || ""));
      const hasCloser = dayShifts.some((shift) => timeHour(shift.end) >= Math.max(closingHour - 1, 20));
      if (dayShifts.length > 0 && !hasManager) {
        addTip(
          76,
          "improve",
          `No manager or lead is scheduled on ${day}`,
          "Add a lead, supervisor, owner, or manager role to protect accountability during the shift."
        );
      }
      if (dayShifts.length > 0 && !hasCloser) {
        addTip(
          70,
          "improve",
          `No closer is scheduled on ${day}`,
          `Add one employee ending near ${settings.closingTime} or extend an existing shift to cover closing duties.`
        );
      }
    });

    if (metrics.totalCost > 0) {
      const highestCost = Math.max(...metrics.dayCosts);
      const highestIdx = metrics.dayCosts.indexOf(highestCost);
      const revenue = effectiveDayRevenue[highestIdx] || 0;
      const laborPct = revenue > 0 ? highestCost / revenue : 0;
      const targetLaborDollars = revenue > 0 ? revenue * targetLaborPct : 0;
      const overTarget = targetLaborDollars ? highestCost - targetLaborDollars : 0;

      if (highestCost > 0) {
        addTip(
          overTarget > 0 ? 89 : 55,
          overTarget > 0 ? "warning" : "info",
          `${DAYS[highestIdx]} is your highest labor-cost day`,
          overTarget > 0
            ? `${DAYS[highestIdx]} costs ${money(highestCost)} and is ${money(overTarget)} above target. Review this day first for savings.`
            : revenue > 0
              ? `${DAYS[highestIdx]} costs ${money(highestCost)} with labor at ${(laborPct * 100).toFixed(1)}%. Keep an eye on this day if revenue changes.`
              : `${DAYS[highestIdx]} costs ${money(highestCost)}. Add projected revenue to know whether this labor level is healthy.`
        );
      }
    }

    const scheduledEmployees = state.employees.filter((emp) => (employeeHours[emp.emp_id] || 0) > 0);
    if (scheduledEmployees.length >= 2) {
      const hoursList = scheduledEmployees.map((emp) => employeeHours[emp.emp_id] || 0);
      const maxHours = Math.max(...hoursList);
      const minHours = Math.min(...hoursList);
      if (maxHours - minHours >= 18) {
        addTip(
          62,
          "improve",
          `Schedule balance looks uneven`,
          `One employee has ${maxHours.toFixed(1)}h while another has ${minHours.toFixed(1)}h. Move one shift from the highest-hour employee to improve fairness.`
        );
      }
    }

    if (weeklyBudget && metrics.totalCost > weeklyBudget) {
      const overBudget = metrics.totalCost - weeklyBudget;
      addTip(
        97,
        "critical",
        `Weekly labor is ${money(overBudget)} over payroll budget`,
        `Reduce scheduled hours, shorten low-demand shifts, or raise the weekly budget before publishing this schedule.`
      );
    }

    if (effectiveWeekRevenue && metrics.shiftCount) {
      const weeklyLaborPct = metrics.totalCost / effectiveWeekRevenue;
      const weeklyTargetDollars = effectiveWeekRevenue * targetLaborPct;
      const weeklyOverTarget = metrics.totalCost - weeklyTargetDollars;

      if (weeklyLaborPct >= dangerLaborPct) {
        addTip(
          99,
          "critical",
          `Weekly labor is ${(weeklyLaborPct * 100).toFixed(1)}% of expected revenue`,
          weeklyOverTarget > 0
            ? `That is ${money(weeklyOverTarget)} above your ${settings.targetLaborPercent}% target. Start with the highest-cost day and reduce overlap first.`
            : `This is above your ${settings.dangerLaborPercent}% danger setting. Review coverage and shift length before saving.`
        );
      } else if (weeklyLaborPct >= cautionLaborPct) {
        addTip(
          80,
          "warning",
          `Weekly labor is ${(weeklyLaborPct * 100).toFixed(1)}% of expected revenue`,
          `You are above the ${settings.cautionLaborPercent}% caution line. Check the highest-cost day before publishing.`
        );
      } else if (weeklyLaborPct < targetLaborPct * 0.65) {
        addTip(
          50,
          "info",
          "Labor percentage is very lean",
          "Savings look strong, but double-check coverage targets so customer service does not suffer."
        );
      }
    }

    if (!out.length) {
      addTip(
        1,
        "success",
        "Schedule looks balanced",
        "Labor, coverage, overtime, and employee limits all look reasonable based on your saved settings."
      );
    }

    const uniqueTips = [];
    const seen = new Set();
    out.sort((a, b) => b.priority - a.priority).forEach((tip) => {
      const signature = `${tip.title}-${tip.action}`;
      if (!seen.has(signature)) {
        seen.add(signature);
        uniqueTips.push(tip);
      }
    });

    const bestMove = uniqueTips[0] || {
      type: "success",
      title: "Schedule looks balanced",
      action: "Labor, coverage, overtime, and employee limits all look reasonable based on your saved settings.",
    };

    return {
      bestMove,
      items: uniqueTips.slice(1, 4),
      hiddenItems: uniqueTips.slice(4),
      hiddenCount: Math.max(uniqueTips.length - 4, 0),
    };
  }, [state.employees, state.shifts, state.coverage, effectiveDayRevenue, effectiveWeekRevenue, metrics, settings]);

  function addEmployee() {
    const name = employeeForm.name.trim();
    const role = employeeForm.role.trim();
    const wage = num(employeeForm.wage);
    const max = num(employeeForm.max) || 40;

    if (!name) return alert("Name is required.");
    if (wage <= 0) return alert("Enter a valid hourly wage.");

    pushHistorySnapshot();

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

    pushHistorySnapshot();

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

    pushHistorySnapshot();

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
  function deleteShiftQuick(empId, dayIdx, event) {
    event.stopPropagation();

    if (!confirm("Delete this shift?")) return;

    pushHistorySnapshot();

    setState((prev) => {
      const shifts = { ...prev.shifts };
      delete shifts[keyFor(empId, dayIdx)];
      return { ...prev, shifts };
    });

    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }
  function deleteShift() {
    if (!shiftModal) return;

    pushHistorySnapshot();

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

    pushHistorySnapshot();

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
    pushHistorySnapshot();

    setState((prev) => {
      const dailyRevenue = [...prev.dailyRevenue];
      dailyRevenue[index] = value;
      return { ...prev, dailyRevenue };
    });
    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }

  function updateCoverage(index, value) {
    pushHistorySnapshot();

    setState((prev) => {
      const coverage = [...prev.coverage];
      coverage[index] = value;
      return { ...prev, coverage };
    });
    setStatusMessage("Unsaved changes. Press Save Schedule.");
  }

  function exportCsv() {
    const rows = [["Employee", "Role", ...DAYS, "Total Hours"]];

    state.employees.forEach((emp) => {
      let totalH = 0;

      const cells = DAYS.map((_, i) => {
        const shift = state.shifts[keyFor(emp.emp_id, i)];
        if (!shift) return "";
        const hrs = shiftHours(shift.start, shift.end);
        totalH += hrs;
        return `${shift.start}-${shift.end} (${hrs.toFixed(1)}h)`;
      });

      rows.push([emp.name, emp.role || "", ...cells, totalH.toFixed(1)]);
    });

    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (state.currentScheduleName || "employee-schedule").replace(/[^a-z0-9_-]+/gi, "_") + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function printEmployeeSchedule() {
  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    alert("Popup blocked. Please allow popups to print the schedule.");
    return;
  }

  const dates = DAYS.map((day, i) => {
    const date = new Date(weekMonday(state.weekOffset));
    date.setDate(date.getDate() + i);
    return `${day} ${fmtDate(date)}`;
  });

  const rows = state.employees
    .map((emp) => {
      const cells = DAYS.map((_, i) => {
        const shift = state.shifts[keyFor(emp.emp_id, i)];
        if (!shift) return "OFF";

        const hrs = shiftHours(shift.start, shift.end);

        return `
          <div class="shift-time">${shift.start} – ${shift.end}</div>
          <small>${hrs.toFixed(1)} hrs</small>
        `;
      });

      return `
        <tr>
          <td>
            <strong>${emp.name}</strong><br>
            <small>${emp.role || "Employee"}</small>
          </td>
          ${cells.map((cell) => `<td>${cell}</td>`).join("")}
        </tr>
      `;
    })
    .join("");

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Employee Schedule</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 24px;
            color: #111;
            background: #fff;
          }

          h1 {
            margin: 0 0 4px;
            font-size: 24px;
          }

          .subtitle {
            margin-bottom: 20px;
            color: #555;
            font-size: 14px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          }

          th,
          td {
            border: 1px solid #ccc;
            padding: 10px;
            text-align: left;
            vertical-align: top;
          }

          th {
            background: #f2f2f2;
          }

          small {
            color: #555;
          }

          .shift-time {
            font-weight: 700;
          }

          @media print {
            body {
              padding: 0;
            }
          }
        </style>
      </head>

      <body>
        <h1>${state.currentScheduleName || "Employee Schedule"}</h1>
        <div class="subtitle">${weekLabel(state.weekOffset)}</div>

        <table>
          <thead>
            <tr>
              <th>Employee</th>
              ${dates.map((date) => `<th>${date}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="8">No employees scheduled.</td></tr>`}
          </tbody>
        </table>

        <script>
          window.onload = function () {
            setTimeout(function () {
              window.print();
            }, 300);
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

  function goToNextWeek() {
    const copySchedule = confirm(
      "Do you want to start next week using this week’s schedule?\n\nChoose OK to copy this week, or Cancel to start with a blank week."
    );

    pushHistorySnapshot();

    setState((prev) => ({
      ...prev,
      weekOffset: prev.weekOffset + 1,
      shifts: copySchedule ? { ...prev.shifts } : {},
      currentScheduleName: copySchedule
        ? `${prev.currentScheduleName || "Schedule"} - Copy`
        : "",
    }));

    setActiveScheduleId(null);
    setScheduleName(copySchedule ? `${state.currentScheduleName || "Schedule"} - Copy` : "");
    setStatusMessage(
      copySchedule
        ? "Copied this week into next week. Adjust as needed, then save."
        : "Started a blank next week."
    );
  }

  function addHoursToTime(time, hoursToAdd) {
  const [h, m] = String(time || "08:00").split(":").map(Number);
  const start = h * 60 + m;
  const end = start + Math.round(hoursToAdd * 60);
  const eh = Math.floor(end / 60) % 24;
  const em = end % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

function subtractHoursFromTime(time, hoursToSubtract) {
  const [h, m] = String(time || "21:00").split(":").map(Number);
  const end = h * 60 + m;
  let start = end - Math.round(hoursToSubtract * 60);
  if (start < 0) start += 1440;
  const sh = Math.floor(start / 60) % 24;
  const sm = start % 60;
  return `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`;
}

function buildSuggestedSchedule() {
  if (!state.employees.length) {
    alert("Add employees before building a suggested schedule.");
    return;
  }

  pushHistorySnapshot();

  const targetLaborPct = (num(settings.targetLaborPercent) || DEFAULT_SETTINGS.targetLaborPercent) / 100;
  const minStaff = num(settings.minimumStaffPerShift) || DEFAULT_SETTINGS.minimumStaffPerShift;
  const overtimeLimit = num(settings.overtimeThreshold) || DEFAULT_SETTINGS.overtimeThreshold;
  const openingTime = settings.openingTime || DEFAULT_SETTINGS.openingTime;
  const closingTime = settings.closingTime || DEFAULT_SETTINGS.closingTime;
  const busyDays = Array.isArray(settings.busyDays) ? settings.busyDays : [];

  const sortedEmployees = [...state.employees].sort((a, b) => num(a.wage) - num(b.wage));
  const nextShifts = {};
  const assignedHours = {};

  sortedEmployees.forEach((emp) => {
    assignedHours[emp.emp_id] = 0;
  });

  const dayOrder = DAYS.map((day, dayIdx) => ({
    day,
    dayIdx,
    revenue: effectiveDayRevenue[dayIdx] || 0,
    busy: busyDays.includes(dayIdx),
  })).sort((a, b) => {
    if (a.busy !== b.busy) return a.busy ? -1 : 1;
    return b.revenue - a.revenue;
  });

  dayOrder.forEach(({ dayIdx, revenue, busy }) => {
    const availableEmployees = sortedEmployees.filter(
      (emp) => !(emp.unavailable_days || []).includes(dayIdx)
    );

    if (!availableEmployees.length) return;

    const avgWage =
      availableEmployees.reduce((sum, emp) => sum + num(emp.wage), 0) /
      Math.max(availableEmployees.length, 1);

    const laborBudget = revenue > 0 ? revenue * targetLaborPct : 0;

    let suggestedStaff = minStaff;

    if (revenue > 0 && avgWage > 0) {
      suggestedStaff = Math.max(
        minStaff,
        Math.floor(laborBudget / Math.max(avgWage * 8, 1))
      );
    }

    if (busy) suggestedStaff += 1;

    suggestedStaff = Math.min(suggestedStaff, availableEmployees.length);

    const candidates = availableEmployees
      .filter((emp) => {
        const maxHours = emp.max_hours || overtimeLimit;
        return (assignedHours[emp.emp_id] || 0) < maxHours;
      })
      .sort((a, b) => {
        const aHours = assignedHours[a.emp_id] || 0;
        const bHours = assignedHours[b.emp_id] || 0;
        return aHours - bHours || num(a.wage) - num(b.wage);
      })
      .slice(0, suggestedStaff);

    candidates.forEach((emp, index) => {
      const maxHours = emp.max_hours || overtimeLimit;
      const remaining = Math.max(maxHours - (assignedHours[emp.emp_id] || 0), 0);
      const plannedHours = Math.min(8, remaining);

      if (plannedHours <= 0) return;

      const shouldClose = busy && index === candidates.length - 1;

      const start = shouldClose
        ? subtractHoursFromTime(closingTime, plannedHours)
        : openingTime;

      const end = shouldClose
        ? closingTime
        : addHoursToTime(openingTime, plannedHours);

      nextShifts[keyFor(emp.emp_id, dayIdx)] = {
        emp_id: emp.emp_id,
        day_idx: dayIdx,
        start,
        end,
      };

      assignedHours[emp.emp_id] += plannedHours;
    });
  });

  setState((prev) => ({
    ...prev,
    shifts: nextShifts,
  }));

  setActiveScheduleId(null);
  setStatusMessage(
    `Built a suggested schedule using busy days first, your ${settings.targetLaborPercent}% labor target, ${settings.minimumStaffPerShift} minimum staff setting, availability, and max hours. Review and adjust before saving.`
  );
}
    function pushHistorySnapshot() {
    setHistoryStack((prev) => [
      {
        state: JSON.parse(JSON.stringify(state)),
        timestamp: Date.now(),
      },
      ...prev,
    ].slice(0, 25));
  }

  function undoLastAction() {
    if (!historyStack.length) {
      alert("Nothing to undo.");
      return;
    }

    const [latest, ...rest] = historyStack;

    setState(latest.state);
    setHistoryStack(rest);
    setStatusMessage("Undid last action.");
  }
  function clearWeek() {
    if (!confirm("Clear all shifts for this week? Employees and inputs stay.")) return;

    pushHistorySnapshot();

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

          <div className="planner-actions-clean">

                {/* PRIMARY */}
                <div className="planner-action-section">
                  <div className="planner-section-label">BUILD</div>

                  <div className="planner-action-row">
                    <button
                      className="small-btn primary big-action-btn"
                      type="button"
                      onClick={() => saveCurrentSchedule()}
                      disabled={saving}
                    >
                      {saving ? "Saving..." : "💾 Save Schedule"}
                    </button>

                    <button
                      className="small-btn primary big-action-btn"
                      type="button"
                      onClick={buildSuggestedSchedule}
                    >
                      Build Suggested
                    </button>

                    <button
                      className="small-btn"
                      type="button"
                      onClick={undoLastAction}
                      disabled={!historyStack.length}
                    >
                      ↶ Undo
                    </button>
                  </div>
                </div>

                {/* MANAGEMENT */}
                <div className="planner-action-section">
                  <div className="planner-section-label">MANAGE</div>

                  <div className="planner-action-row">
                    <button
                      className="small-btn"
                      type="button"
                      onClick={() => {
                        setScheduleName(state.currentScheduleName || "");
                        setScheduleModalOpen(true);
                      }}
                    >
                      📅 Manager
                    </button>

                    <button
                      className="small-btn"
                      type="button"
                      onClick={createNewSchedule}
                    >
                      New
                    </button>

                    <button
                      className="small-btn"
                      type="button"
                      onClick={openSettingsModal}
                    >
                      ⚙ Settings
                    </button>
                  </div>
                </div>

                {/* UTILITIES */}
                <div className="planner-action-section">
                  <div className="planner-section-label">TOOLS</div>

                  <div className="planner-action-row">
                    <button
                      className="small-btn"
                      type="button"
                      onClick={printEmployeeSchedule}
                    >
                      Print
                    </button>

                    <button
                      className="small-btn"
                      type="button"
                      onClick={exportCsv}
                    >
                      CSV
                    </button>

                    <button
                      className="small-btn danger"
                      type="button"
                      onClick={clearWeek}
                    >
                      Clear
                    </button>
                  </div>
                </div>

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

              <div className="mini-label">Expected Revenue</div>
              <div className="planner-card">
                <p className="subtle-text">Use last week’s revenue, recent sales, or your best estimate to forecast the upcoming schedule.</p>
                <label className="checkbox-label">
                  <input
                    checked={state.revenueMode === "weekly"}
                    onChange={(e) => {
                      setState((p) => ({ ...p, revenueMode: e.target.checked ? "weekly" : "daily" }));
                      setStatusMessage("Unsaved changes. Press Save Schedule.");
                    }}
                    type="checkbox"
                  />
                  Use expected weekly revenue only
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
                <div className="labor-caption">LABOR % OF EXPECTED WEEKLY REVENUE</div>
              </div>
            </aside>

            <section className="planner-main">
              <div className="week-bar">
                <div className="week-left">
                  <button className="small-btn" type="button" onClick={() => setState((p) => ({ ...p, weekOffset: p.weekOffset - 1 }))}>
                    ‹
                  </button>
                  <div className="week-title">{weekLabel(state.weekOffset)}</div>
                  <button className="small-btn" type="button" onClick={goToNextWeek}>
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
                <div className="stat-card"><span>Over Danger Days</span><strong>{metrics.over}</strong></div>
              </div>

              <div className="grid-wrap">
                <div className="schedule-grid">
                  <div className="emp-head-cell">Employee</div>
                  {DAYS.map((day, i) => {
                    const date = new Date(weekMonday(state.weekOffset));
                    date.setDate(date.getDate() + i);
                    return (
                      <div className="grid-head" key={day}>
                        <div>{day}</div>
                        <span>{fmtDate(date)}</span>
                        <strong className="grid-day-cost">{money(metrics.dayCosts[i])}</strong>
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
                                <div
                                    className="shift-card"
                                    role="button"
                                    tabIndex={0}
                                    style={{ color: color.fg, background: color.bg }}
                                    onClick={() => openShift(emp.emp_id, i)}
                                    onKeyDown={(e) => e.key === "Enter" && openShift(emp.emp_id, i)}
                                  >
                                    <button
                                      className="shift-delete-x"
                                      type="button"
                                      title="Delete shift"
                                      onClick={(e) => deleteShiftQuick(emp.emp_id, i, e)}
                                    >
                                      ×
                                    </button>

                                    <div className="shift-time">{shift.start} – {shift.end}</div>
                                    <div className="shift-hours">{hrs.toFixed(1)}h</div>
                                    <div className="shift-cost">{money(cost)}</div>
                                  </div>
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
                <div className="suggestions-head">
                  <div>
                    <div className="suggestions-title">💡 Smart labor suggestions</div>
                    <div className="suggestions-subtitle">Showing the best move plus the top priority fixes.</div>
                  </div>
                  {tips.hiddenCount > 0 && (
                  <button
                    className="tips-toggle-btn"
                    type="button"
                    onClick={() => setShowAllTips((prev) => !prev)}
                  >
                    {showAllTips
                      ? "Show fewer warnings"
                      : `Show ${tips.hiddenCount} more warning${tips.hiddenCount === 1 ? "" : "s"}`}
                  </button>
                )}
                </div>

                <div className={`best-move insight-${tips.bestMove.type || "info"}`}>
                  <div className="best-move-label">Best cost-control move</div>
                  <strong>{tips.bestMove.title}</strong>
                  <p>{tips.bestMove.action}</p>
                </div>

                <div className="insight-list">
                  {(showAllTips
                    ? [...tips.items, ...(tips.hiddenItems || [])]
                    : tips.items
                  ).map((tip, index) => (
                    <div
                      className={`insight-card insight-${tip.type || "info"}`}
                      key={`${tip.title}-${index}`}
                    >
                      <strong>{tip.title}</strong>
                      <p>{tip.action}</p>
                    </div>
                  ))}
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

      {settingsModalOpen && (
        <div className="modal-backdrop open" onClick={() => !settingsIntroMode && setSettingsModalOpen(false)}>
          <div className="modal settings-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-head">
              <div>
                <div className="demo-eyebrow">{settingsIntroMode ? "First-Time Setup" : "Shift Planner Settings"}</div>
                <h3>{settingsIntroMode ? "Welcome to Shift Planner" : "Settings"}</h3>
                <p>{settingsIntroMode ? "Let’s personalize your labor targets and scheduling preferences." : "Adjust labor targets, overtime rules, coverage rules, business hours, and scheduling preferences."}</p>
              </div>
              {!settingsIntroMode && <button className="icon-btn" type="button" onClick={() => setSettingsModalOpen(false)}>×</button>}
            </div>

            <form onSubmit={savePlannerSettings}>
              <div className="settings-section-title">Labor targets</div>
              <div className="settings-grid">
                <label><span>Target Labor %</span><input className="field" type="number" min="1" max="100" step="0.1" value={settingsForm.targetLaborPercent} onChange={(e) => setSettingsForm((p) => ({ ...p, targetLaborPercent: e.target.value }))} /></label>
                <label><span>Caution at %</span><input className="field" type="number" min="1" max="100" step="0.1" value={settingsForm.cautionLaborPercent} onChange={(e) => setSettingsForm((p) => ({ ...p, cautionLaborPercent: e.target.value }))} /></label>
                <label><span>Danger at %</span><input className="field" type="number" min="1" max="100" step="0.1" value={settingsForm.dangerLaborPercent} onChange={(e) => setSettingsForm((p) => ({ ...p, dangerLaborPercent: e.target.value }))} /></label>
                <label><span>Weekly Payroll Budget</span><input className="field" type="number" min="0" step="0.01" placeholder="Optional" value={settingsForm.weeklyBudget || ""} onChange={(e) => setSettingsForm((p) => ({ ...p, weeklyBudget: e.target.value }))} /></label>
              </div>
              <p className="settings-hint">Recommended: restaurants 25–35%, retail 15–25%, service businesses 30–45%.</p>

              <div className="settings-section-title">Overtime and coverage rules</div>
              <div className="settings-grid">
                <label><span>Overtime Threshold</span><input className="field" type="number" min="1" step="0.5" value={settingsForm.overtimeThreshold} onChange={(e) => setSettingsForm((p) => ({ ...p, overtimeThreshold: e.target.value }))} /></label>
                <label><span>Minimum Staff Per Shift</span><input className="field" type="number" min="1" step="1" value={settingsForm.minimumStaffPerShift} onChange={(e) => setSettingsForm((p) => ({ ...p, minimumStaffPerShift: e.target.value }))} /></label>
                <label><span>Max Consecutive Days</span><input className="field" type="number" min="1" max="14" step="1" value={settingsForm.maxConsecutiveDays} onChange={(e) => setSettingsForm((p) => ({ ...p, maxConsecutiveDays: e.target.value }))} /></label>
                <label><span>Business Type</span><select className="field" value={settingsForm.businessType} onChange={(e) => setSettingsForm((p) => ({ ...p, businessType: e.target.value }))}>{BUSINESS_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
              </div>

              <div className="settings-section-title">Business hours</div>
              <div className="settings-grid">
                <label><span>Opening Time</span><input className="field" type="time" value={settingsForm.openingTime} onChange={(e) => setSettingsForm((p) => ({ ...p, openingTime: e.target.value }))} /></label>
                <label><span>Closing Time</span><input className="field" type="time" value={settingsForm.closingTime} onChange={(e) => setSettingsForm((p) => ({ ...p, closingTime: e.target.value }))} /></label>
                <label><span>Labor Strategy</span><select className="field" value={settingsForm.preferredStrategy} onChange={(e) => setSettingsForm((p) => ({ ...p, preferredStrategy: e.target.value }))}>{LABOR_STRATEGIES.map((strategy) => <option key={strategy} value={strategy}>{strategy}</option>)}</select></label>
              </div>

              <div className="settings-section-title">Busy days</div>
              <div className="settings-day-grid">
                {DAYS.map((day, i) => (
                  <button type="button" className={`check-day ${settingsForm.busyDays?.includes(i) ? "active" : ""}`} key={`busy-${day}`} onClick={() => setSettingsForm((p) => ({ ...p, busyDays: p.busyDays?.includes(i) ? p.busyDays.filter((d) => d !== i) : [...(p.busyDays || []), i] }))}>{day}</button>
                ))}
              </div>

              <div className="settings-summary-card"><strong>These settings power your tips and suggested schedules.</strong><span>Warnings now adjust to your labor %, overtime threshold, minimum staff, busy days, and business hours.</span></div>

              <div className="button-row right-buttons">
                {!settingsIntroMode && <button className="small-btn" type="button" onClick={() => setSettingsModalOpen(false)}>Cancel</button>}
                <button className="small-btn primary" type="submit">Save Settings</button>
              </div>
            </form>
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