import test from "node:test";
import assert from "node:assert/strict";
import {
  attendance,
  laborReport,
  pricingImport,
  plannedSegments,
} from "../src/workforce/attendance.mjs";
const week = "2026-10-12",
  at = (t) => Date.parse(t),
  end = at("2026-10-20T00:00Z");
function fixture() {
  return {
    business: {
      name: "Pilot",
      timezone: "America/New_York",
      week_start: 1,
      overtime_hours: 40,
      overtime_multiplier: 1.5,
      tolerance_minutes: 5,
      matching_window_minutes: 240,
    },
    employees: [{ id: "a", name: "Alex", role: "Service", max_hours: 40 }],
    rates: [{ employee_id: "a", effective_at: "2020-01-01T00:00Z", rate: 20 }],
    plans: [
      {
        id: "p",
        employee_id: "a",
        active: true,
        starts_at: "2026-10-13T13:00Z",
        ends_at: "2026-10-13T21:00Z",
        planned_break_start: "2026-10-13T17:00Z",
        planned_break_minutes: 30,
        planned_break_paid: false,
      },
    ],
    events: [],
    attendance_reviews: [],
    approvals: [],
  };
}
function punches(d, items) {
  d.events = items.map(([event_type, time, paid_break = false], i) => ({
    id: "e" + i,
    employee_id: "a",
    event_type,
    occurred_at: "2026-10-13T" + time + "Z",
    paid_break,
  }));
  return d;
}
test("tolerance suppresses small alerts without rounding exact punches or paid hours", () => {
  const d = punches(fixture(), [
    ["clock_in", "13:04"],
    ["break_start", "17:00"],
    ["break_end", "17:30"],
    ["clock_out", "21:04"],
  ]);
  const before = JSON.stringify(d);
  const row = attendance(d, week, end)[0];
  assert.deepEqual(row.flags, []);
  assert.equal(row.start, at("2026-10-13T13:04Z"));
  assert.equal(row.paidHours, 7.5);
  assert.equal(JSON.stringify(d), before);
  d.business.tolerance_minutes = 0;
  assert.equal(attendance(d, week, end)[0].flags.length, 2);
});
test("planned versus actual breaks retain exact net time and variance", () => {
  const d = punches(fixture(), [
    ["clock_in", "13:06"],
    ["break_start", "17:00"],
    ["break_end", "17:35"],
    ["clock_out", "21:12"],
  ]);
  const row = attendance(d, week, end)[0];
  assert.equal(row.plannedHours, 7.5);
  assert.ok(Math.abs(row.paidHours - (7 + 31 / 60)) < 1e-10);
  assert.ok(row.flags.some((f) => f.startsWith("Late clock-in")));
  assert.equal(laborReport(d, week, end)[0].actual.cost, 150.33);
  d.plans[0].planned_break_paid = true;
  assert.equal(laborReport(d, week, end)[0].scheduled.hours, 8);
});
test("ambiguous candidates and competing sessions require explicit assignment", () => {
  const d = punches(fixture(), [
    ["clock_in", "13:00"],
    ["clock_out", "16:00"],
    ["clock_in", "17:00"],
    ["clock_out", "21:00"],
  ]);
  let rows = attendance(d, week, end);
  assert.equal(
    rows.filter((r) => r.flags.includes("Ambiguous shift match")).length,
    2,
  );
  d.attendance_reviews = [0, 2].map((i) => ({
    clock_in_id: "e" + i,
    item_key: "session:e" + i,
    decision: "match",
    plan_id: "p",
    fingerprint: "old",
  }));
  rows = attendance(d, week, end);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessions.length, 2);
  assert.equal(rows[0].paidHours, 7);
  const d2 = punches(fixture(), [
    ["clock_in", "16:30"],
    ["clock_out", "17:30"],
  ]);
  d2.plans.push({
    ...d2.plans[0],
    id: "p2",
    starts_at: "2026-10-13T18:00Z",
    ends_at: "2026-10-13T22:00Z",
    planned_break_minutes: 0,
    planned_break_start: null,
  });
  assert.ok(
    attendance(d2, week, end).some((r) =>
      r.flags.includes("Ambiguous shift match"),
    ),
  );
});
test("corrections reopen reviewed evidence without changing original plan", () => {
  const d = punches(fixture(), [
    ["clock_in", "13:10"],
    ["clock_out", "21:00"],
  ]);
  let row = attendance(d, week, end)[0];
  d.attendance_reviews.push({
    item_key: row.key,
    decision: "review",
    fingerprint: row.fingerprint,
  });
  assert.equal(attendance(d, week, end)[0].reviewed, true);
  d.events[0].occurred_at = "2026-10-13T13:11Z";
  assert.equal(attendance(d, week, end)[0].reviewed, false);
  assert.equal(d.plans[0].starts_at, "2026-10-13T13:00Z");
});
test("forecast uses actual work plus remaining paid plan without overlap or an assumed unscheduled end", () => {
  const d = punches(fixture(), [["clock_in", "13:06"]]);
  let report = laborReport(d, week, at("2026-10-13T16:00Z"))[0];
  assert.ok(Math.abs(report.forecast.hours - 7.4) < 1e-10);
  assert.ok(Math.abs(report.actual.hours - 2.9) < 1e-10);
  d.events.push({
    id: "out",
    employee_id: "a",
    event_type: "clock_out",
    occurred_at: "2026-10-13T16:00Z",
  });
  report = laborReport(d, week, at("2026-10-13T18:00Z"))[0];
  assert.equal(report.forecast.hours, 2.9);
  d.plans = [];
  d.events.pop();
  report = laborReport(d, week, at("2026-10-13T16:00Z"))[0];
  assert.equal(report.forecast.hours, report.actual.hours);
  assert.equal(report.uncertain, true);
});
test("planned unpaid break crossing workweek splits at exact elapsed instants", () => {
  const d = fixture();
  d.plans[0] = {
    ...d.plans[0],
    starts_at: "2026-10-19T02:00Z",
    ends_at: "2026-10-19T10:00Z",
    planned_break_start: "2026-10-19T03:45Z",
    planned_break_minutes: 30,
  };
  assert.equal(laborReport(d, week, end)[0].scheduled.hours, 1.75);
  assert.equal(laborReport(d, "2026-10-19", end)[0].scheduled.hours, 5.75);
  const fall = {
    starts_at: "2026-11-01T04:00Z",
    ends_at: "2026-11-01T09:00Z",
    planned_break_start: "2026-11-01T05:45Z",
    planned_break_minutes: 30,
  };
  assert.equal(
    plannedSegments(fall).reduce((n, x) => n + (x.end - x.start) / 3600000, 0),
    4.5,
  );
});
test("pricing import preserves overtime and historical rate costs, never substitutes maximum hours", () => {
  const d = fixture();
  d.business.overtime_hours = 5;
  d.rates.push({
    employee_id: "a",
    effective_at: "2026-10-13T18:00Z",
    rate: 30,
  });
  d.employees.push({ id: "unused", name: "Unused", max_hours: 168 });
  const result = pricingImport(d, week, "scheduled", end);
  assert.equal(result.tiers.length, 1);
  assert.equal(result.cost, 217.5);
  assert.equal(
    Number(result.tiers[0].wage) * Number(result.tiers[0].hours_per_week),
    217.5,
  );
  d.plans = [];
  assert.throws(
    () => pricingImport(d, week, "scheduled", end),
    /No paid hours/,
  );
});
test("actual pricing imports require completed approved timesheets and complete rate history", () => {
  const d = punches(fixture(), [
    ["clock_in", "13:00"],
    ["clock_out", "21:00"],
  ]);
  assert.throws(
    () => pricingImport(d, week, "actual", at("2026-10-13T22:00Z")),
    /completed/,
  );
  assert.throws(() => pricingImport(d, week, "actual", end), /Approve/);
  d.approvals = [{ employee_id: "a", week_start: week }];
  assert.equal(pricingImport(d, week, "actual", end).cost, 160);
  d.rates = [];
  assert.throws(() => pricingImport(d, week, "actual", end), /wages/);
});
test("reviewing an upcoming plan does not suppress a later missing-punch warning", () => {
  const d = fixture();
  const future = at("2026-10-13T12:00Z");
  let row = attendance(d, week, future)[0];
  d.attendance_reviews = [
    { item_key: row.key, decision: "review", fingerprint: row.fingerprint },
  ];
  assert.equal(attendance(d, week, future)[0].reviewed, true);
  row = attendance(d, week, at("2026-10-13T14:00Z"))[0];
  assert.equal(row.reviewed, false);
  assert.ok(row.flags.includes("Missing clock-in"));
});
test("attendance crossing beyond the scheduled week remains visible in the actual week", () => {
  const d = fixture();
  d.plans[0] = {
    ...d.plans[0],
    starts_at: "2026-10-19T02:00Z",
    ends_at: "2026-10-19T03:50Z",
    planned_break_start: null,
    planned_break_minutes: 0,
  };
  d.events = [
    {
      id: "a",
      employee_id: "a",
      event_type: "clock_in",
      occurred_at: "2026-10-19T02:00Z",
    },
    {
      id: "b",
      employee_id: "a",
      event_type: "clock_out",
      occurred_at: "2026-10-19T05:00Z",
    },
  ];
  const next = attendance(d, "2026-10-19", end);
  assert.equal(next.length, 1);
  assert.equal(next[0].plan.id, "p");
  assert.equal(laborReport(d, "2026-10-19", end)[0].actual.hours, 1);
});
test("paid break overrun is visible even when paid hours match the schedule", () => {
  const d = punches(fixture(), [
    ["clock_in", "13:00"],
    ["break_start", "17:00", true],
    ["break_end", "18:00", true],
    ["clock_out", "21:00"],
  ]);
  d.plans[0].planned_break_paid = true;
  const row = attendance(d, week, end)[0];
  assert.equal(row.paidHours, 8);
  assert.equal(row.breakMinutes, 60);
  assert.ok(row.flags.includes("Break variance: +30.0 min"));
});
