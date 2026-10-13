import React, { useState } from "react";
import { attendance, laborReport } from "./attendance.mjs";
import { displayTime, money, downloadCsv } from "./model.mjs";
export default function Attendance({ data, week, asOf, rpc, run }) {
  const [editing, setEditing] = useState(null),
    [all, setAll] = useState(false);
  const rows = attendance(data, week, asOf),
    pending = rows.filter((r) => r.flags.length && !r.reviewed);
  const report = laborReport(data, week, asOf),
    fmt = (t) => displayTime(t, data.business.timezone);
  const punch = (t) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: data.business.timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    }).format(new Date(t));
  const total = (k) => report.reduce((n, r) => n + r[k].cost, 0);
  const exportRows = () =>
    downloadCsv(`reimage-attendance-${week}.csv`, [
      ["Reimage Tech", data.business.name, week, data.business.timezone],
      [
        "Employee",
        "Scheduled start",
        "Scheduled end",
        "Actual start",
        "Actual end",
        "Planned paid hours",
        "Actual paid hours",
        "Findings",
        "Review",
      ],
      ...rows.map((r) => [
        data.employees.find((e) => e.id === r.employee_id)?.name,
        r.plan ? fmt(r.plan.starts_at) : "",
        r.plan ? fmt(r.plan.ends_at) : "",
        r.start ? new Date(r.start).toISOString() : "",
        r.end ? new Date(r.end).toISOString() : r.open ? "Open" : "",
        r.plannedHours.toFixed(4),
        r.paidHours.toFixed(4),
        r.flags.join("; "),
        r.reviewed ? r.review.reason : "Pending",
      ]),
    ]);
  return (
    <section className="rt-panel">
      <div className="rt-panel-title">
        <div>
          <h2>Schedule vs attendance</h2>
          <p>
            {pending.length} exceptions to review ·{" "}
            {data.business.tolerance_minutes ?? 5}-minute alert tolerance. Exact
            punches determine worked time.
          </p>
        </div>
        <button type="button" onClick={exportRows}>
          Export attendance
        </button>
      </div>
      <p>
        Published plan:{" "}
        <strong>
          {report.some((r) => r.scheduled.missingRate)
            ? "Incomplete"
            : money(total("scheduled"))}
        </strong>{" "}
        · Actual so far:{" "}
        <strong>
          {report.some((r) => r.actual.missingRate)
            ? "Incomplete"
            : money(total("actual"))}
        </strong>{" "}
        · Week forecast:{" "}
        <strong>
          {report.some((r) => r.forecast.missingRate)
            ? "Incomplete"
            : money(total("forecast"))}
        </strong>
      </p>
      <p>
        Forecast combines recorded time with remaining published shifts. Closed
        shifts use actual time; unscheduled open work has no assumed end.{" "}
        {report.some((r) => r.uncertain)
          ? "Attendance gaps make this estimate uncertain."
          : ""}
      </p>
      <label className="rt-check no-print">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
        />
        Show all shifts and reviewed exceptions
      </label>
      <div className="rt-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Published plan</th>
              <th>Recorded attendance</th>
              <th>Paid hours</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {(all ? rows : pending).map((r) => (
              <tr key={r.key}>
                <td>
                  {data.employees.find((e) => e.id === r.employee_id)?.name}
                </td>
                <td>
                  {r.plan ? (
                    <>
                      {fmt(r.plan.starts_at)}
                      <br />
                      {fmt(r.plan.ends_at)}
                      <small>
                        {r.plan.planned_break_minutes || 0} min{" "}
                        {r.plan.planned_break_paid ? "paid" : "unpaid"} planned
                        break
                      </small>
                    </>
                  ) : (
                    "No confirmed shift"
                  )}
                </td>
                <td>
                  {r.sessions.length
                    ? r.sessions.map((s) => (
                        <div key={s.id}>
                          {punch(s.start)}
                          <br />
                          {s.end ? punch(s.end) : "Still open — provisional"}
                        </div>
                      ))
                    : "No clock-in"}
                </td>
                <td>
                  {r.plannedHours.toFixed(2)} planned
                  <br />
                  {r.paidHours.toFixed(2)} actual
                </td>
                <td>
                  {r.flags.map((f) => (
                    <small key={f}>{f}</small>
                  ))}
                  {r.reviewed ? (
                    <small>Reviewed: {r.review.reason}</small>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({ ...r, revision: data.attendance_revision })
                    }
                  >
                    Review attendance
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!(all ? rows : pending).length && (
        <p>
          No {all ? "shifts or attendance" : "unreviewed exceptions"} in this
          week.
        </p>
      )}
      {editing && (
        <form
          className="rt-form-grid no-print"
          key={editing.key}
          onSubmit={async (e) => {
            e.preventDefault();
            const p = Object.fromEntries(new FormData(e.currentTarget));
            const result = await run(
              () =>
                rpc("rt_review_attendance", {
                  b: data.business.id,
                  p: {
                    ...p,
                    clock_in_id: editing.sessions[0]?.id || null,
                    plan_id:
                      p.decision === "unscheduled"
                        ? null
                        : p.plan_id || editing.plan?.id || null,
                    fingerprint: editing.fingerprint,
                    revision: editing.revision,
                  },
                }),
              "Attendance review saved; timesheet approval reset",
            );
            if (result) setEditing(null);
          }}
        >
          <h3>
            Review{" "}
            {data.employees.find((e) => e.id === editing.employee_id)?.name}
          </h3>
          <label>
            Decision
            <select name="decision">
              <option value="review">
                Acknowledge the recorded difference
              </option>
              {editing.sessions.length > 0 && (
                <>
                  <option value="match">Assign to a published shift</option>
                  <option value="unscheduled">Confirm unscheduled work</option>
                </>
              )}
            </select>
          </label>
          {editing.sessions.length > 0 && (
            <label>
              Published shift (for assignment)
              <select name="plan_id" defaultValue={editing.plan?.id || ""}>
                <option value="">Choose a shift</option>
                {(data.plans || [])
                  .filter(
                    (p) => p.active && p.employee_id === editing.employee_id,
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {fmt(p.starts_at)} – {fmt(p.ends_at)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Review reason
            <input name="reason" required minLength={3} maxLength={1000} />
          </label>
          <p>
            Review keeps recorded times unchanged. Use Clock activity below to
            correct a missing or incorrect punch. A changed match may need a
            fresh review.
          </p>
          <button>Save attendance review</button>
          <button type="button" onClick={() => setEditing(null)}>
            Cancel review
          </button>
        </form>
      )}
      <details>
        <summary>Attendance review history</summary>
        {(data.attendance_reviews || [])
          .slice()
          .reverse()
          .map((r) => (
            <p key={r.id}>
              {fmt(r.created_at)} ·{" "}
              {data.employees.find((e) => e.id === r.employee_id)?.name} ·{" "}
              {r.decision} · {r.reason} · actor {r.actor_id}
            </p>
          ))}
      </details>
    </section>
  );
}
