import { bounds, costIntervals, intervals } from "./model.mjs";
const ms = (t) => Date.parse(t);
export function plannedSegments(s) {
  const start = ms(s.starts_at),
    end = ms(s.ends_at),
    at = ms(s.planned_break_start);
  if (!s.planned_break_minutes || s.planned_break_paid) return [{ start, end }];
  return [
    { start, end: at },
    { start: at + Number(s.planned_break_minutes) * 60000, end },
  ].filter((x) => x.end > x.start);
}
export function sessions(events, asOf = Date.now()) {
  const result = [];
  let current;
  for (const e of [...events]
    .filter((e) => ms(e.occurred_at) <= asOf)
    .sort((a, b) => ms(a.occurred_at) - ms(b.occurred_at))) {
    if (e.event_type === "clock_in") {
      current = {
        id: e.id,
        employee_id: e.employee_id,
        start: ms(e.occurred_at),
        end: null,
        events: [],
      };
      result.push(current);
    }
    if (current) current.events.push(e);
    if (e.event_type === "clock_out" && current) {
      current.end = ms(e.occurred_at);
      current = null;
    }
  }
  return result.map((s) => ({
    ...s,
    paid: intervals(s.events, asOf).intervals,
  }));
}
export function attendance(data, week, asOf = Date.now()) {
  const [lo, hi] = bounds(week, data.business.timezone),
    tolerance = Number(data.business.tolerance_minutes ?? 5) * 60000;
  const window = Number(data.business.matching_window_minutes ?? 240) * 60000;
  const plans = (data.plans || []).filter((p) => p.active);
  const all = data.employees.flatMap((e) =>
    sessions(
      data.events.filter((x) => x.employee_id === e.id),
      asOf,
    ),
  );
  const reviews = data.attendance_reviews || [];
  const latest = (key) => reviews.filter((r) => r.item_key === key).at(-1);
  const assigned = all.map((s) => {
    const review = reviews
      .filter((r) => r.clock_in_id === s.id && r.decision !== "review")
      .at(-1);
    const candidates = plans.filter(
      (p) =>
        p.employee_id === s.employee_id &&
        (Math.abs(ms(p.starts_at) - s.start) <= window ||
          (s.start >= ms(p.starts_at) && s.start < ms(p.ends_at))),
    );
    const manual =
      review &&
      (review.decision === "unscheduled" ||
        plans.some(
          (p) => p.id === review.plan_id && p.employee_id === s.employee_id,
        ));
    return {
      ...s,
      candidates,
      manual: !!manual,
      plan_id: manual
        ? review.plan_id
        : candidates.length === 1
          ? candidates[0].id
          : null,
      forcedUnscheduled: manual && review.decision === "unscheduled",
    };
  });
  // Two sessions competing for one planned shift need an explicit manager assignment.
  const counts = new Map();
  for (const s of assigned)
    if (s.plan_id) counts.set(s.plan_id, (counts.get(s.plan_id) || 0) + 1);
  for (const s of assigned)
    if (!s.manual && counts.get(s.plan_id) > 1) s.plan_id = null;
  const make = (plan, ss) => {
    const first = ss[0],
      end =
        ss.length && ss.every((s) => s.end !== null)
          ? Math.max(...ss.map((s) => s.end))
          : null;
    const paidHours = ss
      .flatMap((s) => s.paid)
      .reduce((n, x) => n + (x.end - x.start) / 3600000, 0);
    const plannedHours = plan
      ? plannedSegments(plan).reduce(
          (n, x) => n + (x.end - x.start) / 3600000,
          0,
        )
      : 0;
    const breakMinutes = ss.reduce(
      (total, s) =>
        total +
        s.events.reduce(
          (sum, e, i) =>
            e.event_type === "break_start"
              ? sum +
                ((s.events[i + 1] ? ms(s.events[i + 1].occurred_at) : asOf) -
                  ms(e.occurred_at)) /
                  60000
              : sum,
          0,
        ),
      0,
    );
    const flags = [];
    if (!plan)
      flags.push(
        first.forcedUnscheduled
          ? "Unscheduled work"
          : first.candidates.length
            ? "Ambiguous shift match"
            : "Unscheduled work",
      );
    else if (!ss.length && asOf > ms(plan.starts_at) + tolerance)
      flags.push("Missing clock-in");
    else if (ss.length) {
      const startDelta = first.start - ms(plan.starts_at);
      if (Math.abs(startDelta) > tolerance)
        flags.push(
          `${startDelta > 0 ? "Late" : "Early"} clock-in: ${Math.abs(startDelta / 60000).toFixed(1)} min`,
        );
      if (end !== null) {
        const delta = end - ms(plan.ends_at);
        if (Math.abs(delta) > tolerance)
          flags.push(
            `${delta > 0 ? "Late" : "Early"} clock-out: ${Math.abs(delta / 60000).toFixed(1)} min`,
          );
        const breakDelta =
          breakMinutes - Number(plan.planned_break_minutes || 0);
        if (Math.abs(breakDelta * 60000) > tolerance)
          flags.push(
            `Break variance: ${breakDelta >= 0 ? "+" : ""}${breakDelta.toFixed(1)} min`,
          );
        const deltaHours = paidHours - plannedHours;
        if (Math.abs(deltaHours * 3600000) > tolerance)
          flags.push(
            `Paid time variance: ${deltaHours >= 0 ? "+" : ""}${(deltaHours * 60).toFixed(1)} min`,
          );
      }
    }
    if (
      ss.some(
        (s) =>
          s.end === null &&
          asOf > (plan ? ms(plan.ends_at) + tolerance : s.start + 16 * 3600000),
      )
    )
      flags.push("Missing clock-out");
    const key = first ? "session:" + first.id : "plan:" + plan.id;
    // Exact evidence, not the ticking clock, determines whether a previous review is still current.
    const fingerprint = JSON.stringify([
      plan
        ? [
            plan.id,
            plan.starts_at,
            plan.ends_at,
            plan.planned_break_start,
            plan.planned_break_minutes,
            plan.planned_break_paid,
          ]
        : null,
      ss.map((s) =>
        s.events.map((e) => [e.id, e.event_type, e.occurred_at, e.paid_break]),
      ),
      tolerance,
      window,
      flags,
    ]);
    const review = latest(key);
    return {
      key,
      employee_id: plan?.employee_id || first.employee_id,
      plan,
      sessions: ss,
      start: first?.start,
      end,
      paidHours,
      breakMinutes,
      plannedHours,
      flags,
      fingerprint,
      review,
      reviewed: review?.fingerprint === fingerprint,
      open: ss.some((s) => s.end === null),
    };
  };
  const rows = plans
    .filter(
      (p) =>
        (ms(p.starts_at) < hi && ms(p.ends_at) > lo) ||
        assigned.some(
          (s) => s.plan_id === p.id && s.start < hi && (s.end ?? asOf) > lo,
        ),
    )
    .map((p) =>
      make(
        p,
        assigned
          .filter((s) => s.plan_id === p.id)
          .sort((a, b) => a.start - b.start),
      ),
    );
  for (const s of assigned.filter(
    (s) => !s.plan_id && s.start < hi && (s.end ?? asOf) > lo,
  ))
    rows.push(make(null, [s]));
  return rows.sort(
    (a, b) =>
      (a.start ?? ms(a.plan.starts_at)) - (b.start ?? ms(b.plan.starts_at)),
  );
}
function union(segments) {
  const result = [];
  for (const s of segments
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && last.end >= s.start) {
      last.end = Math.max(last.end, s.end);
      last.provisional ||= s.provisional;
    } else result.push({ ...s });
  }
  return result;
}
export function laborReport(data, week, asOf = Date.now()) {
  const matches = attendance(data, week, asOf),
    [lo, hi] = bounds(week, data.business.timezone);
  return data.employees.map((e) => {
    const rates = data.rates.filter((r) => r.employee_id === e.id),
      actualSegments = intervals(
        data.events.filter((x) => x.employee_id === e.id),
        asOf,
      ).intervals;
    const plans = (data.plans || []).filter(
      (p) =>
        p.active &&
        p.employee_id === e.id &&
        ms(p.starts_at) < hi &&
        ms(p.ends_at) > lo,
    );
    const remaining = plans.flatMap((p) => {
      const match = matches.find((r) => r.plan?.id === p.id);
      if (match?.sessions.length && !match.open) return [];
      return plannedSegments(p)
        .map((s) => ({ ...s, start: Math.max(s.start, asOf) }))
        .filter((s) => s.end > s.start);
    });
    const actual = costIntervals(actualSegments, rates, data.business, week);
    const scheduled = costIntervals(
      union(plans.flatMap(plannedSegments)),
      rates,
      data.business,
      week,
    );
    const forecast = costIntervals(
      union([...actualSegments, ...remaining]),
      rates,
      data.business,
      week,
    );
    const uncertain = matches.filter(
      (r) =>
        r.employee_id === e.id &&
        ((r.open && !r.plan) ||
          r.flags.includes("Missing clock-out") ||
          (!r.sessions.length && r.plan && ms(r.plan.starts_at) < asOf) ||
          (!r.plan && !r.reviewed)),
    );
    return {
      ...e,
      actual,
      scheduled,
      forecast,
      uncertain: uncertain.length > 0,
    };
  });
}
export function pricingImport(data, week, basis, asOf = Date.now()) {
  if (!["scheduled", "actual", "forecast"].includes(basis))
    throw Error("Choose a labor basis.");
  const rows = laborReport(data, week, asOf).filter((r) => r[basis].hours > 0);
  if (!rows.length)
    throw Error(
      "No paid hours in this week. Publish a schedule or record attendance first.",
    );
  if (rows.some((r) => r[basis].missingRate))
    throw Error(
      "Historical wages are missing. Complete wage history before importing.",
    );
  if (basis === "actual") {
    if (bounds(week, data.business.timezone)[1] > asOf)
      throw Error("Approved actual imports require a completed workweek.");
    if (
      rows.some(
        (r) =>
          r.actual.provisional ||
          !data.approvals.some(
            (a) => a.employee_id === r.id && a.week_start === week,
          ),
      )
    )
      throw Error(
        "Approve every worked timesheet before importing actual labor.",
      );
  }
  const tiers = rows.map((r) => ({
    role: `${r.role || "Staff"} · ${r.name}`,
    wage: String(Number((r[basis].cost / r[basis].hours).toFixed(8))),
    hours_per_week: String(Number(r[basis].hours.toFixed(8))),
  }));
  return {
    tiers,
    hours: rows.reduce((n, r) => n + r[basis].hours, 0),
    cost: rows.reduce((n, r) => n + r[basis].cost, 0),
    uncertain: basis === "forecast" && rows.some((r) => r.uncertain),
    label: `${data.business.name} · ${week} · ${basis === "actual" ? "approved actual" : basis} · ${data.business.timezone}`,
  };
}
