import { plannedSegments } from "./attendance.mjs";
import { Temporal } from "@js-temporal/polyfill";
export const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n || 0,
  );
export const addDays = (date, n) =>
  Temporal.PlainDate.from(date).add({ days: n }).toString();
export const localDate = (instant, tz) =>
  Temporal.Instant.from(new Date(instant).toISOString())
    .toZonedDateTimeISO(tz)
    .toPlainDate()
    .toString();
export const weekday = (date) => Temporal.PlainDate.from(date).dayOfWeek % 7;
export function weekFor(date, start = 1) {
  return addDays(date, -((weekday(date) - start + 7) % 7));
}
export function toInstant(date, time, tz, disambiguation = "reject") {
  const local = Temporal.PlainDateTime.from(`${date}T${time}`);
  const zoned = Temporal.ZonedDateTime.from(`${date}T${time}[${tz}]`, {
    disambiguation,
  });
  if (
    disambiguation !== "compatible" &&
    !zoned.toPlainDateTime().equals(local)
  ) {
    throw new RangeError(
      "This local time does not exist because the clock moves forward. Choose an existing time.",
    );
  }
  return zoned.toInstant().toString();
}
export const displayTime = (instant, tz) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(instant));
export const localInput = (instant, tz) =>
  Temporal.Instant.from(new Date(instant).toISOString())
    .toZonedDateTimeISO(tz)
    .toPlainDateTime()
    .toString({ smallestUnit: "second" });
export function bounds(week, tz) {
  return [
    Date.parse(toInstant(week, "00:00", tz, "compatible")),
    Date.parse(toInstant(addDays(week, 7), "00:00", tz, "compatible")),
  ];
}
export function intervals(events, asOf = Date.now()) {
  const result = [];
  let state = "off",
    since = null,
    paid = false,
    openSince = null;
  const flags = [];
  for (const e of [...events].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  )) {
    const at = Date.parse(e.occurred_at);
    if (at > asOf) continue;
    if (
      since !== null &&
      at > since &&
      (state === "working" || (state === "break" && paid))
    )
      result.push({ start: since, end: at });
    if (e.event_type === "clock_in") {
      if (state !== "off") flags.push("Invalid clock sequence");
      state = "working";
      openSince = at;
    }
    if (e.event_type === "break_start") {
      if (state !== "working") flags.push("Invalid clock sequence");
      state = "break";
      paid = e.paid_break;
    }
    if (e.event_type === "break_end") {
      if (state !== "break") flags.push("Invalid clock sequence");
      state = "working";
    }
    if (e.event_type === "clock_out") {
      if (state === "off") flags.push("Invalid clock sequence");
      state = "off";
      openSince = null;
    }
    since = at;
  }
  if (state !== "off" && since !== null) {
    if (state === "working" || paid)
      result.push({ start: since, end: asOf, provisional: true });
    flags.push(
      asOf - openSince > 16 * 3600000
        ? "Missing clock-out: shift open over 16 hours"
        : "Open shift — provisional",
    );
  }
  return { intervals: result, state, flags, openSince };
}
export function costIntervals(segments, rates, business, week) {
  const [lo, hi] = bounds(week, business.timezone);
  let hours = 0,
    regular = 0,
    overtime = 0,
    cost = 0,
    missingRate = false,
    provisional = false;
  const history = [...rates].sort(
    (a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at),
  );
  for (const seg of [...segments].sort((a, b) => a.start - b.start)) {
    const start = Math.max(seg.start, lo),
      end = Math.min(seg.end, hi);
    if (end <= start) continue;
    provisional ||= !!seg.provisional;
    const cuts = [
      start,
      ...history
        .map((r) => Date.parse(r.effective_at))
        .filter((t) => t > start && t < end),
      end,
    ];
    for (let i = 0; i < cuts.length - 1; i++) {
      const duration = (cuts[i + 1] - cuts[i]) / 3600000;
      const rate = history
        .filter((r) => Date.parse(r.effective_at) <= cuts[i])
        .at(-1);
      const reg = Math.max(
          0,
          Math.min(duration, Number(business.overtime_hours) - hours),
        ),
        ot = duration - reg;
      hours += duration;
      regular += reg;
      overtime += ot;
      if (!rate) missingRate = true;
      else
        cost +=
          (reg + ot * Number(business.overtime_multiplier)) * Number(rate.rate);
    }
  }
  return {
    hours,
    regular,
    overtime,
    cost: Math.round(cost * 100) / 100,
    missingRate,
    provisional,
  };
}
export function summarize(data, week, scheduleId, asOf = Date.now()) {
  return data.employees.map((e) => {
    const events = data.events.filter((x) => x.employee_id === e.id);
    const rates = data.rates.filter((x) => x.employee_id === e.id);
    const clock = intervals(events, asOf);
    const actual = costIntervals(clock.intervals, rates, data.business, week);
    const shifts = data.shifts.filter(
      (s) =>
        s.employee_id === e.id &&
        (s.schedule_id === scheduleId ||
          data.schedules.some(
            (z) =>
              z.id === s.schedule_id &&
              z.status === "published" &&
              z.id !== scheduleId &&
              z.week_start !== week,
          )),
    );
    const planned = costIntervals(
      shifts.flatMap(plannedSegments),
      rates,
      data.business,
      week,
    );
    const [lo, hi] = bounds(week, data.business.timezone);
    const flags =
      clock.openSince !== null && clock.openSince < hi && asOf > lo
        ? clock.flags
        : [];
    return { ...e, actual, planned, clock, flags };
  });
}
export function suggestions(data, week, scheduleId, asOf = Date.now()) {
  const rows = summarize(data, week, scheduleId, asOf),
    tips = [];
  const shifts = data.shifts.filter((s) => s.schedule_id === scheduleId);
  const b = data.business;
  for (const row of rows) {
    if (row.actual.overtime > 0 || row.planned.overtime > 0)
      tips.push({
        title: `${row.name}: overtime risk`,
        detail: `${row.planned.overtime.toFixed(1)}h scheduled overtime and ${row.actual.overtime.toFixed(1)}h worked overtime. Review remaining shifts before assigning more hours.`,
      });
    if (row.planned.hours > Number(row.max_hours))
      tips.push({
        title: `${row.name}: weekly limit exceeded`,
        detail: `${row.planned.hours.toFixed(1)}h scheduled against a ${row.max_hours}h limit.`,
      });
    row.flags.forEach((f) =>
      tips.push({
        title: `${row.name}: ${f}`,
        detail:
          "Check attendance and record a correction with a reason if a punch is missing.",
      }),
    );
    if (row.actual.missingRate || row.planned.missingRate)
      tips.push({
        title: `${row.name}: missing historical wage`,
        detail:
          "Costs are incomplete. Add a verified historical rate before approving this week.",
      });
  }
  const coverage = shifts.flatMap((s) =>
    plannedSegments({ ...s, planned_break_paid: false }).map((segment) => ({
      ...segment,
      employee_id: s.employee_id,
    })),
  );
  for (let i = 0; i < 7; i++) {
    const date = addDays(week, i),
      start = Date.parse(
        toInstant(date, b.opening_time, b.timezone, "compatible"),
      ),
      end = Date.parse(
        toInstant(
          b.closing_time <= b.opening_time ? addDays(date, 1) : date,
          b.closing_time,
          b.timezone,
          "compatible",
        ),
      );
    const points = [
      start,
      end,
      ...coverage
        .flatMap((s) => [s.start, s.end])
        .filter((t) => t > start && t < end),
    ].sort((a, b) => a - b);
    let gap = 0;
    for (let j = 0; j < points.length - 1; j++) {
      const count = new Set(
        coverage
          .filter((s) => s.start <= points[j] && s.end > points[j])
          .map((s) => s.employee_id),
      ).size;
      if (count < Number(b.minimum_staff))
        gap += (points[j + 1] - points[j]) / 3600000;
    }
    if (gap > 0)
      tips.push({
        title: `${date}: coverage gap`,
        detail: `${gap.toFixed(1)} opening hours below your ${b.minimum_staff}-person target.`,
      });
  }
  const planned = rows.reduce((a, r) => a + r.planned.cost, 0),
    actual = rows.reduce((a, r) => a + r.actual.cost, 0),
    revenue = Number(
      data.schedules.find((s) => s.id === scheduleId)?.revenue || 0,
    );
  const target = b.weekly_budget
    ? Number(b.weekly_budget)
    : (revenue * Number(b.target_labor_percent)) / 100;
  if (target > 0 && Math.max(planned, actual) > target)
    tips.unshift({
      title: "Labor exceeds the weekly target",
      detail: `Scheduled ${money(planned)} · worked ${money(actual)} · target ${money(target)}. Review overtime and coverage before reducing hours.`,
    });
  return tips;
}
export function generateSchedule(data, week, revenue = 0) {
  const b = data.business,
    assigned = {},
    shifts = [],
    notes = [];
  const wage = (id) =>
    Number(
      (data.rates || [])
        .filter((r) => r.employee_id === id)
        .sort((a, c) => Date.parse(a.effective_at) - Date.parse(c.effective_at))
        .at(-1)?.rate || 0,
    );
  for (let i = 0; i < 7; i++) {
    const date = addDays(week, i),
      start = toInstant(date, b.opening_time, b.timezone),
      end = toInstant(
        b.closing_time <= b.opening_time ? addDays(date, 1) : date,
        b.closing_time,
        b.timezone,
      );
    const hours = (Date.parse(end) - Date.parse(start)) / 3600000;
    const people = data.employees
      .filter(
        (e) =>
          e.active &&
          !e.unavailable_days.includes(weekday(date)) &&
          (assigned[e.id] || 0) + hours <=
            Math.min(Number(e.max_hours), Number(b.overtime_hours)),
      )
      .sort(
        (a, c) =>
          (assigned[a.id] || 0) - (assigned[c.id] || 0) ||
          wage(a.id) - wage(c.id),
      );
    const selected = people.slice(0, Number(b.minimum_staff));
    if (selected.length < Number(b.minimum_staff))
      notes.push(
        `${date}: only ${selected.length} available employees fit their hour limits.`,
      );
    selected.forEach((e) => {
      assigned[e.id] = (assigned[e.id] || 0) + hours;
      shifts.push({ employee_id: e.id, starts_at: start, ends_at: end });
    });
  }
  const total = data.employees.reduce(
    (sum, e) =>
      sum +
      costIntervals(
        shifts
          .filter((s) => s.employee_id === e.id)
          .map((s) => ({
            start: Date.parse(s.starts_at),
            end: Date.parse(s.ends_at),
          })),
        (data.rates || []).filter((r) => r.employee_id === e.id),
        b,
        week,
      ).cost,
    0,
  );
  const budget =
    Number(b.weekly_budget || 0) ||
    (Number(revenue) * Number(b.target_labor_percent || 35)) / 100;
  if (budget > 0 && total > budget)
    notes.push(
      `Estimated labor ${money(total)} exceeds the ${money(budget)} target. Coverage is preserved; review hours and staffing before publishing.`,
    );
  return { shifts, notes, estimatedCost: total };
}
export function csv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value ?? "");
          if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
          return '"' + text.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
export function downloadCsv(name, rows) {
  const url = URL.createObjectURL(
    new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
