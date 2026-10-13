import test from "node:test";
import assert from "node:assert/strict";
import {
  toInstant,
  bounds,
  intervals,
  costIntervals,
  weekFor,
  csv,
  generateSchedule,
} from "../src/workforce/model.mjs";
const business = {
  timezone: "America/New_York",
  week_start: 1,
  overtime_hours: 40,
  overtime_multiplier: 1.5,
};
const ts = (t) => Date.parse(t),
  rate = [{ effective_at: "2020-01-01T00:00Z", rate: 20 }];
test("timezone weeks follow the business, including daylight saving", () => {
  assert.equal(weekFor("2026-10-13", 1), "2026-10-12");
  assert.equal(
    (bounds("2026-03-02", business.timezone)[1] -
      bounds("2026-03-02", business.timezone)[0]) /
      3600000,
    167,
  );
  assert.equal(
    (bounds("2026-10-26", business.timezone)[1] -
      bounds("2026-10-26", business.timezone)[0]) /
      3600000,
    169,
  );
});
test("ambiguous and nonexistent local times require explicit resolution", () => {
  assert.throws(() => toInstant("2026-11-01", "01:30", business.timezone));
  assert.throws(() => toInstant("2026-03-08", "02:30", business.timezone));
  assert.throws(() =>
    toInstant("2026-03-08", "02:30", business.timezone, "earlier"),
  );
  assert.equal(
    ts(toInstant("2026-11-01", "01:30", business.timezone, "later")) -
      ts(toInstant("2026-11-01", "01:30", business.timezone, "earlier")),
    3600000,
  );
});
test("paid and unpaid breaks use the policy recorded with the event", () => {
  for (const paid of [true, false]) {
    const events = [
      ["clock_in", "08:00"],
      ["break_start", "12:00"],
      ["break_end", "13:00"],
      ["clock_out", "17:00"],
    ].map(([event_type, time]) => ({
      event_type,
      occurred_at: `2026-10-13T${time}:00Z`,
      paid_break: paid,
    }));
    const result = costIntervals(
      intervals(events, ts("2026-10-14T00:00Z")).intervals,
      rate,
      business,
      "2026-10-12",
    );
    assert.equal(result.hours, paid ? 9 : 8);
    assert.equal(result.cost, paid ? 180 : 160);
  }
});
test("weekly overtime and rate changes are calculated chronologically", () => {
  const segments = Array.from({ length: 5 }, (_, i) => ({
    start: ts(`2026-10-${12 + i}T12:00Z`),
    end: ts(`2026-10-${12 + i}T21:00Z`),
  }));
  const out = costIntervals(
    segments,
    [...rate, { effective_at: "2026-10-16T12:00Z", rate: 30 }],
    business,
    "2026-10-12",
  );
  assert.equal(out.hours, 45);
  assert.equal(out.regular, 40);
  assert.equal(out.overtime, 5);
  assert.equal(out.cost, 1065);
});
test("overnight shifts split across workweeks and measure elapsed DST time", () => {
  const seg = [
    { start: ts("2026-10-19T02:00Z"), end: ts("2026-10-19T10:00Z") },
  ];
  assert.equal(costIntervals(seg, rate, business, "2026-10-12").hours, 2);
  assert.equal(costIntervals(seg, rate, business, "2026-10-19").hours, 6);
  const dst = [
    {
      start: ts(toInstant("2026-11-01", "00:00", business.timezone)),
      end: ts(toInstant("2026-11-01", "04:00", business.timezone)),
    },
  ];
  assert.equal(costIntervals(dst, rate, business, "2026-10-26").hours, 5);
});
test("open shifts are provisional; missing historical rates never become silently zero wages", () => {
  const clock = intervals(
    [{ event_type: "clock_in", occurred_at: "2026-10-13T12:00Z" }],
    ts("2026-10-13T16:00Z"),
  );
  const row = costIntervals(clock.intervals, [], business, "2026-10-12");
  assert.equal(row.hours, 4);
  assert.equal(row.provisional, true);
  assert.equal(row.missingRate, true);
});
test("schedule generation honors unavailable days and hour caps", () => {
  const proposal = generateSchedule(
    {
      business: {
        ...business,
        minimum_staff: 2,
        opening_time: "08:00",
        closing_time: "16:00",
      },
      employees: [
        { id: "a", active: true, unavailable_days: [1], max_hours: 16 },
        { id: "b", active: true, unavailable_days: [], max_hours: 40 },
      ],
    },
    "2026-10-12",
  );
  assert.equal(proposal.shifts.filter((s) => s.employee_id === "a").length, 2);
  assert.equal(proposal.shifts.filter((s) => s.employee_id === "b").length, 5);
  assert.ok(proposal.notes.length);
});
test("exports escape quotes and neutralize spreadsheet formulas", () => {
  assert.equal(csv([["=CMD()", 'a"b', "a,b"]]), '"\'=CMD()","a""b","a,b"');
});
test("coverage suggestions account for paid and unpaid planned breaks", async () => {
  const { suggestions } =
    await import("../src/workforce/model.mjs");
  for (const paid of [true, false]) {
    const shift = {
      id: "shift",
      schedule_id: "s",
      employee_id: "a",
      starts_at: "2026-10-13T13:00Z",
      ends_at: "2026-10-13T21:00Z",
      planned_break_start: "2026-10-13T17:00Z",
      planned_break_minutes: 30,
      planned_break_paid: paid,
    };
    const data = {
      business: {
        ...business,
        opening_time: "09:00",
        closing_time: "17:00",
        minimum_staff: 1,
      },
      employees: [{ id: "a", name: "Alex", max_hours: 40 }],
      events: [],
      rates: rate.map((r) => ({ ...r, employee_id: "a" })),
      schedules: [{ id: "s", week_start: "2026-10-12", status: "draft" }],
      shifts: [shift],
    };
    assert.ok(
      suggestions(data, "2026-10-12", "s", ts("2026-10-13T12:00Z")).some(
        (t) =>
          t.title === "2026-10-13: coverage gap" && t.detail.startsWith("0.5"),
      ),
    );
  }
});
