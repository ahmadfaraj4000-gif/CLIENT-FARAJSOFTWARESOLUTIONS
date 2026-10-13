import React, { useEffect, useState, useRef } from "react";
import Attendance from "./Attendance.jsx";
import { attendance, laborReport } from "./attendance.mjs";
import QRCode from "qrcode";
import {
  addDays,
  weekFor,
  localDate,
  toInstant,
  displayTime,
  localInput,
  money,
  summarize,
  suggestions,
  generateSchedule,
  downloadCsv,
  bounds,
} from "./model.mjs";
import "./workforce.css";
const tabs = [
  "Overview",
  "Schedule",
  "Time Clock",
  "Timesheets",
  "Employees",
  "Settings",
];
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const values = (event) => Object.fromEntries(new FormData(event.currentTarget));
export function Field({ label, ...props }) {
  return (
    <label>
      {label}
      <input {...props} />
    </label>
  );
}
function Select({ label, children, ...props }) {
  return (
    <label>
      {label}
      <select {...props}>{children}</select>
    </label>
  );
}
const Button = ({ children, ...props }) => (
  <button type="button" {...props}>
    {children}
  </button>
);
function Empty({ children }) {
  return <div className="rt-empty">{children}</div>;
}
export default function Workforce({ supabase, user }) {
  const [bootstrap, setBootstrap] = useState(null),
    [businessId, setBusinessId] = useState(""),
    [data, setData] = useState(null),
    [tab, setTab] = useState("Overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [week, setWeek] = useState(""),
    [scheduleId, setScheduleId] = useState(""),
    [employee, setEmployee] = useState(null),
    [code, setCode] = useState(null),
    [qr, setQr] = useState(""),
    [proposal, setProposal] = useState(null),
    [tick, setTick] = useState(Date.now()),
    [correction, setCorrection] = useState(null),
    [editingShift, setEditingShift] = useState(null);
  const requestVersion = useRef(0);
  const rpc = async (name, args) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw Error(error.message);
    return data;
  };
  async function init() {
    try {
      const boot = await rpc("rt_bootstrap", {});
      setBootstrap(boot);
      if (boot.businesses.length)
        setBusinessId(
          (boot.businesses.find((b) => b.entitled) || boot.businesses[0]).id,
        );
    } catch (e) {
      setError(e.message);
    }
  }
  async function load(id = businessId) {
    if (!id) return;
    const version = ++requestVersion.current;
    let d;
    try {
      d = await rpc("rt_dashboard", { b: id });
    } catch (e) {
      if (version === requestVersion.current) {
        setData(null);
        setCode(null);
        setError(e.message);
      }
      throw e;
    }
    if (version !== requestVersion.current) return;
    setData(d);
    setTick(Date.now());
    setError("");
    setWeek(
      (w) =>
        w ||
        weekFor(
          localDate(Date.now(), d.business.timezone),
          d.business.week_start,
        ),
    );
  }
  useEffect(() => {
    init();
  }, []);
  useEffect(() => {
    requestVersion.current++;
    setData(null);
    setWeek("");
    setScheduleId("");
    setEmployee(null);
    setCorrection(null);
    setProposal(null);
    setCode(null);
    setEditingShift(null);
    load(businessId).catch((e) => setError(e.message));
  }, [businessId]);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(Date.now());
      if (businessId) load(businessId).catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [businessId]);
  useEffect(() => {
    setEditingShift(null);
    setProposal(null);
  }, [week]);
  const weekSchedules =
    data?.schedules.filter((s) => s.week_start === week) || [];
  const selected =
    weekSchedules.find((s) => s.id === scheduleId) ||
    weekSchedules.find((s) => s.status === "published") ||
    weekSchedules[0];
  const clockUrl = data
    ? `${window.location.origin}${window.location.pathname}?app=clock&tag=${data.location.tag}`
    : "";
  useEffect(() => {
    if (clockUrl)
      QRCode.toDataURL(clockUrl, {
        width: 260,
        margin: 2,
        errorCorrectionLevel: "M",
      })
        .then(setQr)
        .catch((e) => setError(e.message));
  }, [clockUrl]);
  async function run(fn, message = "Saved") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      await load();
      setNotice(message);
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const manage = (action, p = {}) =>
    rpc("rt_manage", { b: businessId || null, action, p });
  const mutate = (action, p, message) => run(() => manage(action, p), message);
  const draftRows =
    data && week ? summarize(data, week, selected?.id, tick) : [];
  const matching = data && week ? attendance(data, week, tick) : [];
  const report = data && week ? laborReport(data, week, tick) : [];
  const rows =
    tab === "Schedule"
      ? draftRows
      : draftRows.map((r) => ({
          ...r,
          planned: report.find((p) => p.id === r.id)?.scheduled || r.planned,
        }));
  const forecastCost = report.reduce((n, r) => n + r.forecast.cost, 0);
  const tips =
    data && week
      ? [
          ...report
            .filter((r) => r.forecast.overtime > r.actual.overtime)
            .map((r) => ({
              title: `${r.name}: forecast overtime`,
              detail: `${r.forecast.overtime.toFixed(1)}h estimated overtime from actual work plus remaining published shifts. Review future assignments before publishing changes.`,
            })),
          ...(Number(data.business.weekly_budget) > 0 &&
          forecastCost > Number(data.business.weekly_budget)
            ? [
                {
                  title: "Forecast exceeds the labor budget",
                  detail: `${money(forecastCost)} estimated gross wages versus ${money(data.business.weekly_budget)} budget. Attendance gaps may change this estimate.`,
                },
              ]
            : []),
          ...matching
            .filter((r) => r.flags.length && !r.reviewed)
            .map((r) => ({
              title: `${data.employees.find((e) => e.id === r.employee_id)?.name}: attendance review`,
              detail:
                r.flags.join(" · ") +
                ". Review Schedule vs attendance in Timesheets.",
            })),
          ...suggestions(data, week, selected?.id, tick),
        ]
      : [];
  const totals = rows.reduce(
    (a, r) => ({
      scheduled: a.scheduled + r.planned.cost,
      actual: a.actual + r.actual.cost,
      hours: a.hours + r.actual.hours,
      plannedHours: a.plannedHours + r.planned.hours,
    }),
    { scheduled: 0, actual: 0, hours: 0, plannedHours: 0 },
  );
  const format = (t) => displayTime(t, data.business.timezone);
  const shifts =
    data?.shifts
      .filter((s) => s.schedule_id === selected?.id)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)) || [];
  const exportTimes = () =>
    downloadCsv(`reimage-timesheets-${week}.csv`, [
      ["Reimage Tech", data.business.name, week, data.business.timezone],
      [
        "Employee",
        "Scheduled hours",
        "Worked hours",
        "Regular hours",
        "Overtime hours",
        "Scheduled wages",
        "Actual wages",
        "Review",
      ],
      ...rows.map((r) => [
        r.name,
        r.planned.hours.toFixed(2),
        r.actual.hours.toFixed(2),
        r.actual.regular.toFixed(2),
        r.actual.overtime.toFixed(2),
        r.planned.missingRate ? "Incomplete" : r.planned.cost.toFixed(2),
        r.actual.missingRate ? "Incomplete" : r.actual.cost.toFixed(2),
        r.flags.length
          ? r.flags.join("; ")
          : r.actual.missingRate
            ? "Missing rate"
            : data.approvals.some(
                  (a) => a.employee_id === r.id && a.week_start === week,
                )
              ? "Approved"
              : "Needs approval",
      ]),
    ]);
  const exportSchedule = () =>
    downloadCsv(`reimage-schedule-${week}.csv`, [
      [
        "Reimage Tech",
        data.business.name,
        selected?.name,
        selected?.status,
        data.business.timezone,
      ],
      ["Employee", "Start", "End", "Planned break minutes", "Break paid"],
      ...shifts.map((s) => [
        data.employees.find((e) => e.id === s.employee_id)?.name,
        format(s.starts_at),
        format(s.ends_at),
        s.planned_break_minutes || 0,
        s.planned_break_paid ? "Yes" : "No",
      ]),
    ]);
  if (!bootstrap)
    return (
      <main className="rt-app">
        <h1>Reimage Tech</h1>
        <p role="status">{error || "Loading your workspace…"}</p>
      </main>
    );
  if (!businessId)
    return (
      <main className="rt-onboarding">
        <a href="/">Reimage Tech</a>
        <span className="rt-kicker">SHIFT PLANNER</span>
        <h1>
          Your team.
          <br />
          One connected week.
        </h1>
        <p>Schedules, time tracking, and labor costs together.</p>
        {error && (
          <p role="alert" className="rt-error">
            {error}
          </p>
        )}
        {bootstrap.can_create ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const p = values(e);
              const r = await run(
                () => manage("create_business", p),
                "Business created",
              );
              if (r) {
                await init();
                setBusinessId(r.id);
              }
            }}
          >
            <Field label="Business name" name="name" required minLength={2} />
            <Field
              label="Business timezone"
              name="timezone"
              defaultValue="America/New_York"
              required
            />
            <p>
              Start with USD, a Monday workweek, 40-hour weekly overtime at
              1.5×, and unpaid breaks. Review these settings before creating
              schedules.
            </p>
            <button disabled={busy}>Create workspace</button>
          </form>
        ) : (
          <Empty>
            Your pilot access is not active yet. Ask Reimage Tech to grant Shift
            Planner access. Invited managers can sign in using their invited
            email.
          </Empty>
        )}
      </main>
    );
  if (!data || !week)
    return (
      <main className="rt-app">
        <h1>Shift Planner</h1>
        <p role="status">{error || "Loading business…"}</p>
        <a href="/">Return to client portal</a>
        {bootstrap.businesses.length > 1 && (
          <Select
            label="Business"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
          >
            {bootstrap.businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <Button onClick={() => load().catch((e) => setError(e.message))}>
          Retry
        </Button>
      </main>
    );
  const owner = data.business.owner_id === user.id;
  return (
    <main className="rt-app">
      <header className="rt-header">
        <a className="rt-brand" href="/">
          <span className="rt-mark">R</span> reimage<span>tech</span>
        </a>
        <div className="rt-account">
          <span>{data.business.name}</span>
          {bootstrap.businesses.length > 1 && (
            <select
              aria-label="Business"
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
            >
              {bootstrap.businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <a href="/">Client portal ↗</a>
        </div>
      </header>
      <div className="rt-heading">
        <div>
          <span className="rt-kicker">WORKFORCE / SHIFT PLANNER</span>
          <h1>{tab === "Overview" ? "A clearer view of your week." : tab}</h1>
          <p>Plan confidently. Track time. Know your labor costs.</p>
        </div>
        <div className="rt-week no-print">
          <Button
            aria-label="Previous week"
            onClick={() => setWeek(addDays(week, -7))}
          >
            ←
          </Button>
          <Field
            label="Week starting"
            type="date"
            value={week}
            onChange={(e) => {
              if (e.target.value)
                setWeek(weekFor(e.target.value, data.business.week_start));
            }}
          />
          <Button
            aria-label="Next week"
            onClick={() => setWeek(addDays(week, 7))}
          >
            →
          </Button>
        </div>
      </div>
      <nav className="rt-tabs" aria-label="Shift Planner">
        {tabs.map((t) => (
          <Button
            key={t}
            className={t === tab ? "selected" : ""}
            aria-current={t === tab ? "page" : undefined}
            onClick={() => {
              setTab(t);
              setNotice("");
              setError("");
            }}
          >
            {t}
          </Button>
        ))}
      </nav>
      <div aria-live="polite">
        {notice && <p className="rt-success">{notice}</p>}
        {error && (
          <p className="rt-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!data.business.entitled && (
        <p className="rt-error">
          Pilot access is paused. Reports remain available. Contact Reimage Tech
          to restore editing and new clock-ins.
        </p>
      )}
      <fieldset className="rt-workspace" disabled={busy}>
        {tab === "Overview" && (
          <>
            <div className="rt-stats">
              {[
                [
                  "Scheduled labor",
                  rows.some((r) => r.planned.missingRate)
                    ? "Incomplete"
                    : money(totals.scheduled),
                  `${totals.plannedHours.toFixed(1)} planned hours`,
                ],
                [
                  "Actual labor",
                  rows.some((r) => r.actual.missingRate)
                    ? "Incomplete"
                    : money(totals.actual),
                  `${totals.hours.toFixed(1)} worked hours · open shifts provisional`,
                ],
                [
                  "Week forecast",
                  report.some((r) => r.forecast.missingRate)
                    ? "Incomplete"
                    : money(report.reduce((n, r) => n + r.forecast.cost, 0)),
                  "Actual so far + remaining published shifts · estimate",
                ],
                [
                  "On the clock",
                  rows.filter((r) => r.clock.state !== "off").length,
                  "Across your team right now",
                ],
              ].map(([label, value, sub]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{sub}</small>
                </article>
              ))}
            </div>
            {Number(selected?.revenue) > 0 && (
              <p className="rt-revenue">
                Projected revenue: <strong>{money(selected.revenue)}</strong> ·
                Scheduled labor:{" "}
                <strong>
                  {rows.some((r) => r.planned.missingRate)
                    ? "Incomplete"
                    : ((totals.scheduled / selected.revenue) * 100).toFixed(1) +
                      "%"}
                </strong>{" "}
                · Actual labor / projected revenue:{" "}
                <strong>
                  {rows.some((r) => r.actual.missingRate)
                    ? "Incomplete"
                    : ((totals.actual / selected.revenue) * 100).toFixed(1) +
                      "%"}
                </strong>{" "}
                · Target: {data.business.target_labor_percent}%
              </p>
            )}
            <div className="rt-columns">
              <section className="rt-panel">
                <div className="rt-panel-title">
                  <h2>Your next best actions</h2>
                  <span className="rt-pill">{tips.length} insights</span>
                </div>
                <p>
                  Based on your schedules, attendance, and business settings.
                </p>
                {tips.length ? (
                  tips.map((t, i) => (
                    <article className="rt-insight" key={i}>
                      <span>↗</span>
                      <div>
                        <h3>{t.title}</h3>
                        <p>{t.detail}</p>
                      </div>
                    </article>
                  ))
                ) : (
                  <Empty>No issues found in this week's records.</Empty>
                )}
              </section>
              <section className="rt-panel">
                <h2>Team today</h2>
                {rows.length ? (
                  rows.map((r) => (
                    <div className="rt-person" key={r.id}>
                      <span className="rt-avatar">
                        {r.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <strong>{r.name}</strong>
                        <small>{r.role || "Team member"}</small>
                      </div>
                      <span
                        className={`rt-pill ${r.clock.state === "working" ? "blue" : ""}`}
                      >
                        {r.clock.state === "off"
                          ? "Off shift"
                          : r.clock.state === "break"
                            ? "On break"
                            : "Working"}
                      </span>
                    </div>
                  ))
                ) : (
                  <Empty>Add employees to start planning.</Empty>
                )}
                <Button onClick={() => setTab("Employees")}>
                  Manage employees →
                </Button>
              </section>
            </div>
          </>
        )}
        {tab === "Employees" && (
          <div className="rt-columns">
            <section className="rt-panel">
              <h2>Your people</h2>
              <p>One roster for schedules, clock records, and wage history.</p>
              {data.employees.map((e) => (
                <div className="rt-person" key={e.id}>
                  <span className="rt-avatar">
                    {e.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <strong>{e.name}</strong>
                    <small>
                      {e.role} · {e.active ? "Active" : "Inactive"} ·{" "}
                      {money(
                        data.rates
                          .filter((r) => r.employee_id === e.id)
                          .sort((a, b) =>
                            a.effective_at.localeCompare(b.effective_at),
                          )
                          .at(-1)?.rate,
                      )}
                      /hr
                    </small>
                  </div>
                  <Button onClick={() => setEmployee(e)}>Edit</Button>
                  <Button
                    onClick={() =>
                      mutate(
                        "active",
                        { employee_id: e.id, active: !e.active },
                        e.active
                          ? "Employee deactivated; devices revoked"
                          : "Employee activated",
                      )
                    }
                  >
                    {e.active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              ))}
              {!data.employees.length && (
                <Empty>
                  Add your first employee. They will use the same identity for
                  scheduling and attendance.
                </Empty>
              )}
            </section>
            <section className="rt-panel">
              <h2>{employee ? "Edit employee" : "Add employee"}</h2>
              <form
                key={employee?.id || "new"}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const p = values(e);
                  p.unavailable_days = new FormData(form)
                    .getAll("unavailable_days")
                    .map(Number);
                  const r = await mutate("employee", {
                    ...p,
                    id: employee?.id,
                  });
                  if (r) {
                    setEmployee(null);
                    form.reset();
                  }
                }}
              >
                <Field
                  label="Full name"
                  name="name"
                  required
                  minLength={2}
                  defaultValue={employee?.name}
                />
                <Field label="Role" name="role" defaultValue={employee?.role} />
                <Field
                  label="Hourly wage (USD)"
                  name="rate"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={
                    employee
                      ? data.rates
                          .filter((r) => r.employee_id === employee.id)
                          .sort((a, b) =>
                            a.effective_at.localeCompare(b.effective_at),
                          )
                          .at(-1)?.rate
                      : ""
                  }
                />
                <Field
                  label="Maximum weekly hours"
                  name="max_hours"
                  type="number"
                  min="1"
                  max="168"
                  defaultValue={employee?.max_hours || 40}
                />
                <div>
                  <strong>Unavailable days</strong>
                  <div className="rt-checks">
                    {days.map((d, i) => (
                      <label key={d}>
                        <input
                          type="checkbox"
                          name="unavailable_days"
                          value={i}
                          defaultChecked={employee?.unavailable_days.includes(
                            i,
                          )}
                        />
                        {d}
                      </label>
                    ))}
                  </div>
                </div>
                <p>
                  Wage changes apply from now. Existing rates remain in history.
                </p>
                <button>Save employee</button>
                {employee && (
                  <Button onClick={() => setEmployee(null)}>Cancel</Button>
                )}
              </form>
              {employee && (
                <>
                  <h3>Wage history</h3>
                  {data.rates
                    .filter((r) => r.employee_id === employee.id)
                    .map((r) => (
                      <p key={r.id}>
                        {money(r.rate)}/hr from {format(r.effective_at)}
                      </p>
                    ))}
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const p = values(e);
                      await run(
                        () =>
                          rpc("rt_add_rate", {
                            b: businessId,
                            emp: employee.id,
                            rate: Number(p.rate),
                            effective: toInstant(
                              p.date,
                              "00:00",
                              data.business.timezone,
                            ),
                            reason: p.reason,
                          }),
                        "Historical rate added; approvals reset",
                      );
                    }}
                  >
                    <Field
                      label="Historical rate"
                      name="rate"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                    />
                    <Field
                      label="Effective date"
                      name="date"
                      type="date"
                      required
                    />
                    <Field
                      label="Reason / source"
                      name="reason"
                      required
                      minLength={3}
                    />
                    <button>Add historical rate</button>
                  </form>
                </>
              )}
            </section>
          </div>
        )}
        {tab === "Schedule" && (
          <>
            <section className="rt-panel no-print">
              <div className="rt-toolbar">
                <Select
                  label="Saved schedules"
                  value={selected?.id || ""}
                  onChange={(e) => {
                    setScheduleId(e.target.value);
                    setEditingShift(null);
                  }}
                >
                  <option value="">Choose a schedule</option>
                  {weekSchedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.status}
                    </option>
                  ))}
                </Select>
                <Button
                  onClick={async () => {
                    const r = await mutate(
                      "schedule",
                      { week_start: week, name: `Week of ${week}` },
                      "Draft created",
                    );
                    if (r) setScheduleId(r.id);
                  }}
                >
                  New draft
                </Button>
                <Button
                  onClick={() => {
                    try {
                      setProposal(
                        generateSchedule(data, week, selected?.revenue || 0),
                      );
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Suggest a schedule
                </Button>
                {selected && (
                  <>
                    <Button
                      onClick={() =>
                        mutate(
                          selected.status === "published" ? "draft" : "publish",
                          { schedule_id: selected.id },
                          selected.status === "published"
                            ? "Returned to draft"
                            : "Schedule published",
                        )
                      }
                    >
                      {selected.status === "published"
                        ? "Return to draft"
                        : "Publish schedule"}
                    </Button>
                    <Button onClick={exportSchedule}>Export CSV</Button>
                    <Button onClick={() => window.print()}>Print</Button>
                  </>
                )}
              </div>
              {selected && (
                <form
                  className="rt-inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutate("revenue", {
                      schedule_id: selected.id,
                      revenue: values(e).revenue,
                    });
                  }}
                >
                  <Field
                    label="Projected weekly revenue (USD)"
                    name="revenue"
                    type="number"
                    min="0"
                    step="0.01"
                    key={selected.id}
                    defaultValue={selected.revenue}
                  />
                  <button>Save revenue</button>
                </form>
              )}
            </section>
            {proposal && (
              <section className="rt-panel">
                <h2>Review suggested schedule</h2>
                <p>
                  {proposal.shifts.length} shifts balancing availability,
                  coverage, weekly limits, and overtime. This creates a new
                  draft; publishing is a separate step.
                </p>
                {proposal.notes.map((n) => (
                  <p key={n} className="rt-error">
                    {n}
                  </p>
                ))}
                <div className="rt-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Start</th>
                        <th>End</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposal.shifts.map((s, i) => (
                        <tr key={i}>
                          <td>
                            {
                              data.employees.find((e) => e.id === s.employee_id)
                                ?.name
                            }
                          </td>
                          <td>{format(s.starts_at)}</td>
                          <td>{format(s.ends_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button
                  onClick={async () => {
                    const r = await run(
                      () =>
                        rpc("rt_save_proposal", {
                          b: businessId,
                          w: week,
                          items: proposal.shifts,
                        }),
                      "Suggested draft saved",
                    );
                    if (r) {
                      setScheduleId(r.id);
                      setProposal(null);
                    }
                  }}
                >
                  Accept as draft
                </Button>
                <Button onClick={() => setProposal(null)}>
                  Discard suggestion
                </Button>
              </section>
            )}
            {selected ? (
              <section className="rt-panel">
                <div className="rt-panel-title">
                  <h2>{selected.name}</h2>
                  <span className="rt-pill">
                    {selected.status} ·{" "}
                    {rows.some((r) => r.planned.missingRate)
                      ? "Cost incomplete"
                      : money(totals.scheduled)}
                  </span>
                </div>
                <p>
                  Published shifts remain visible while you edit a draft.
                  Started published shifts are preserved for attendance
                  comparison.
                </p>
                <div className="rt-calendar">
                  {Array.from({ length: 7 }, (_, i) => addDays(week, i)).map(
                    (date) => (
                      <div key={date}>
                        <h3>
                          {days[new Date(date + "T12:00:00Z").getUTCDay()]}{" "}
                          <small>{date.slice(5)}</small>
                        </h3>
                        {shifts
                          .filter(
                            (s) =>
                              localDate(s.starts_at, data.business.timezone) ===
                              date,
                          )
                          .map((s) => (
                            <article className="rt-shift" key={s.id}>
                              <strong>
                                {
                                  data.employees.find(
                                    (e) => e.id === s.employee_id,
                                  )?.name
                                }
                              </strong>
                              <small>
                                {format(s.starts_at)}
                                <br />
                                to {format(s.ends_at)}
                                <br />
                                {s.planned_break_minutes || 0} min{" "}
                                {s.planned_break_paid ? "paid" : "unpaid"}{" "}
                                planned break
                              </small>
                              {selected.status === "draft" && (
                                <Button onClick={() => setEditingShift(s)}>
                                  Edit
                                </Button>
                              )}
                              {selected.status === "draft" && (
                                <Button
                                  aria-label="Remove shift"
                                  onClick={() =>
                                    mutate("delete_shift", {
                                      schedule_id: selected.id,
                                      id: s.id,
                                    })
                                  }
                                >
                                  Remove
                                </Button>
                              )}
                            </article>
                          ))}
                      </div>
                    ),
                  )}
                </div>
                {selected.status === "draft" && (
                  <form
                    key={editingShift?.id || selected.id + week}
                    className="rt-form-grid no-print"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const p = values(e);
                      try {
                        let endDate = p.date;
                        if (p.end <= p.start) endDate = addDays(endDate, 1);
                        const saved = await mutate(
                          "shift",
                          {
                            id: editingShift?.id,
                            schedule_id: selected.id,
                            employee_id: p.employee_id,
                            starts_at: toInstant(
                              p.date,
                              p.start,
                              data.business.timezone,
                              p.dst,
                            ),
                            planned_break_minutes: Number(
                              p.planned_break_minutes || 0,
                            ),
                            planned_break_paid: p.planned_break_paid === "on",
                            planned_break_start:
                              Number(p.planned_break_minutes) > 0
                                ? toInstant(
                                    p.break_time < p.start
                                      ? addDays(p.date, 1)
                                      : p.date,
                                    p.break_time,
                                    data.business.timezone,
                                    p.dst,
                                  )
                                : null,
                            ends_at: toInstant(
                              endDate,
                              p.end,
                              data.business.timezone,
                              p.dst,
                            ),
                          },
                          editingShift ? "Shift updated" : "Shift added",
                        );
                        if (saved) setEditingShift(null);
                      } catch (err) {
                        setError("Check shift times: " + err.message);
                      }
                    }}
                  >
                    <Select
                      label="Employee"
                      name="employee_id"
                      required
                      defaultValue={editingShift?.employee_id}
                    >
                      {data.employees
                        .filter((e) => e.active)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </Select>
                    <Field
                      label="Date"
                      type="date"
                      name="date"
                      min={week}
                      max={addDays(week, 6)}
                      defaultValue={
                        editingShift
                          ? localDate(
                              editingShift.starts_at,
                              data.business.timezone,
                            )
                          : week
                      }
                      required
                    />
                    <Field
                      label="Starts"
                      type="time"
                      name="start"
                      defaultValue={
                        editingShift
                          ? localInput(
                              editingShift.starts_at,
                              data.business.timezone,
                            ).slice(11, 16)
                          : "08:00"
                      }
                      required
                    />
                    <Field
                      label="Ends (next day if earlier)"
                      type="time"
                      name="end"
                      defaultValue={
                        editingShift
                          ? localInput(
                              editingShift.ends_at,
                              data.business.timezone,
                            ).slice(11, 16)
                          : "17:00"
                      }
                      required
                    />
                    <Field
                      label="Planned break starts"
                      type="time"
                      name="break_time"
                      defaultValue={
                        editingShift?.planned_break_start
                          ? localInput(
                              editingShift.planned_break_start,
                              data.business.timezone,
                            ).slice(11, 16)
                          : "12:00"
                      }
                    />
                    <Field
                      label="Planned break (minutes)"
                      type="number"
                      name="planned_break_minutes"
                      min="0"
                      max="480"
                      required
                      defaultValue={editingShift?.planned_break_minutes || 0}
                    />
                    <label className="rt-check">
                      <input
                        name="planned_break_paid"
                        type="checkbox"
                        defaultChecked={
                          editingShift?.planned_break_paid ??
                          data.business.paid_breaks
                        }
                      />
                      Planned break is paid
                    </label>
                    <p>
                      Planned breaks affect estimates only. Employees record
                      actual breaks explicitly.
                    </p>
                    <Select label="Repeated DST hour" name="dst">
                      <option value="reject">Ask if ambiguous</option>
                      <option value="earlier">First occurrence</option>
                      <option value="later">Second occurrence</option>
                    </Select>
                    <button>
                      {editingShift ? "Update shift" : "Add shift"}
                    </button>
                    {editingShift && (
                      <Button onClick={() => setEditingShift(null)}>
                        Cancel edit
                      </Button>
                    )}
                  </form>
                )}
              </section>
            ) : (
              <Empty>
                Create a draft schedule or generate a suggestion for this week.
              </Empty>
            )}
            {owner && data.legacy.length > 0 && (
              <section className="rt-panel no-print">
                <h2>Import existing schedules</h2>
                <p>
                  Confirm the actual historical week. Relative week offsets are
                  never assumed to be dates. Originals are preserved;
                  conflicting employee identities stop the import for review.
                </p>
                {data.legacy.map((s) => (
                  <form
                    className="rt-inline"
                    key={s.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const p = values(e);
                      run(
                        () =>
                          rpc("rt_import_schedule", {
                            b: businessId,
                            legacy: s.id,
                            confirmed_week: p.week,
                          }),
                        "Legacy schedule imported",
                      );
                    }}
                  >
                    <span>
                      {s.name} · {s.week_label}
                    </span>
                    <Field
                      label="Confirmed week start"
                      type="date"
                      name="week"
                      required
                    />
                    <button>Import once</button>
                  </form>
                ))}
              </section>
            )}
          </>
        )}
        {tab === "Time Clock" && (
          <div className="rt-columns">
            <section className="rt-panel">
              <span className="rt-kicker">TAP. CONFIRM. GET TO WORK.</span>
              <h2>Your workplace clock</h2>
              {qr && (
                <img
                  className="rt-qr"
                  src={qr}
                  alt="QR code for this business's employee clock"
                />
              )}
              <p>
                <a href={clockUrl} target="_blank" rel="noreferrer">
                  Open employee clock ↗
                </a>
              </p>
              <Field label="NFC tag URL" readOnly value={clockUrl} />
              <Button
                onClick={() =>
                  run(
                    () => navigator.clipboard.writeText(clockUrl),
                    "Clock link copied",
                  )
                }
              >
                Copy clock link
              </Button>
              <ol>
                <li>
                  Use your NFC tag-writing app to write this URL to a tag.
                </li>
                <li>Place the tag and QR code at your workplace.</li>
                <li>
                  Give each employee their enrollment code for their first tap.
                </li>
                <li>
                  Employees confirm each clock or break action on their phone.
                </li>
              </ol>
              <p>
                {data.location.geofence
                  ? "Location verification is enabled."
                  : "Location checks are off. Enable them in Settings if required."}
              </p>
              <Button
                onClick={() => {
                  if (
                    window.confirm(
                      "Replace this clock link? Existing NFC tags and printed QR codes will need updating.",
                    )
                  )
                    mutate("rotate_tag", {}, "Clock link replaced");
                }}
              >
                Replace clock link
              </Button>
              <a
                className="rt-link-button"
                href={qr}
                download="reimage-clock-qr.png"
              >
                Download QR
              </a>
            </section>
            <section className="rt-panel">
              <h2>Enroll employee phones</h2>
              <p>
                Codes expire in 24 hours and work once. Enrolling a replacement
                phone revokes the previous phone.
              </p>
              {code && (
                <div className="rt-code">
                  <strong>{code.name}</strong>
                  <code>{code.code}</code>
                  <small>
                    Share privately. Expires {format(code.expires_at)}.
                  </small>
                  <Button onClick={() => setCode(null)}>Hide code</Button>
                </div>
              )}
              {data.employees
                .filter((e) => e.active)
                .map((e) => (
                  <div className="rt-person" key={e.id}>
                    <strong>{e.name}</strong>
                    <Button
                      onClick={async () => {
                        const r = await mutate(
                          "enroll",
                          { employee_id: e.id },
                          "Enrollment code created",
                        );
                        if (r) setCode({ ...r, name: e.name });
                      }}
                    >
                      Create code
                    </Button>
                    <Button
                      onClick={() =>
                        mutate(
                          "revoke_devices",
                          { employee_id: e.id },
                          "Employee devices revoked",
                        )
                      }
                    >
                      Revoke phones
                    </Button>
                  </div>
                ))}
            </section>
          </div>
        )}
        {tab === "Timesheets" && (
          <>
            <Attendance
              data={data}
              week={week}
              asOf={tick}
              rpc={rpc}
              run={run}
            />
            <section className="rt-panel">
              <div className="rt-panel-title">
                <div>
                  <h2>Worked time & labor</h2>
                  <p>
                    {week} – {addDays(week, 6)} · {data.business.timezone} ·
                    gross wages, before taxes and benefits
                  </p>
                </div>
                <div className="rt-toolbar">
                  <Button onClick={exportTimes}>Export CSV</Button>
                  <Button onClick={() => window.print()}>Print report</Button>
                </div>
              </div>
              <div className="rt-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Scheduled</th>
                      <th>Worked</th>
                      <th>Overtime</th>
                      <th>Scheduled cost</th>
                      <th>Actual cost</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td>{r.planned.hours.toFixed(2)}h</td>
                        <td>
                          {r.actual.hours.toFixed(2)}h
                          {r.actual.provisional ? " *" : ""}
                        </td>
                        <td>{r.actual.overtime.toFixed(2)}h</td>
                        <td>
                          {r.planned.missingRate
                            ? "Incomplete"
                            : money(r.planned.cost)}
                        </td>
                        <td>
                          {r.actual.missingRate
                            ? "Incomplete"
                            : money(r.actual.cost)}
                        </td>
                        <td>
                          {r.flags.map((f) => (
                            <small key={f}>{f}</small>
                          ))}
                          {data.approvals.some(
                            (a) =>
                              a.employee_id === r.id && a.week_start === week,
                          ) ? (
                            <span className="rt-pill">Approved</span>
                          ) : (
                            <Button
                              disabled={
                                r.actual.provisional ||
                                r.actual.missingRate ||
                                bounds(week, data.business.timezone)[1] > tick
                              }
                              onClick={() =>
                                mutate(
                                  "approve",
                                  { employee_id: r.id, week_start: week },
                                  "Timesheet approved",
                                )
                              }
                            >
                              Approve
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                * Open shifts are provisional. Only completed weeks with
                resolved punches can be approved.
              </p>
            </section>
            <section className="rt-panel">
              <h2>Clock activity</h2>
              <div className="rt-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Event</th>
                      <th>Recorded time</th>
                      <th>Source</th>
                      <th>Correction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events
                      .filter((e) => {
                        const [a, b] = bounds(week, data.business.timezone);
                        return (
                          Date.parse(e.occurred_at) >= a &&
                          Date.parse(e.occurred_at) < b
                        );
                      })
                      .slice()
                      .reverse()
                      .map((e) => (
                        <tr key={e.id}>
                          <td>
                            {
                              data.employees.find((p) => p.id === e.employee_id)
                                ?.name
                            }
                          </td>
                          <td>{e.event_type.replaceAll("_", " ")}</td>
                          <td>{format(e.occurred_at)}</td>
                          <td>
                            {e.source}
                            {e.corrected ? " · corrected" : ""}
                          </td>
                          <td>
                            <Button onClick={() => setCorrection(e)}>
                              Correct
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <h3>
                {correction ? "Correct recorded event" : "Add missing punch"}
              </h3>
              <form
                key={correction?.id || "missing"}
                className="rt-form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  const p = values(e);
                  try {
                    const [date, time] = p.time.split("T");
                    mutate(
                      "correction",
                      {
                        employee_id: p.employee_id,
                        event_id: correction?.id,
                        event_type: p.event_type,
                        occurred_at: toInstant(
                          date,
                          time,
                          data.business.timezone,
                          p.dst,
                        ),
                        reason: p.reason,
                        void: p.void === "on",
                      },
                      "Correction recorded; approvals reset",
                    ).then((r) => {
                      if (r) setCorrection(null);
                    });
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                <Select
                  label="Employee"
                  name="employee_id"
                  defaultValue={correction?.employee_id}
                >
                  {data.employees
                    .filter(
                      (e) => !correction || e.id === correction.employee_id,
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </Select>
                <Select
                  label="Action"
                  name="event_type"
                  defaultValue={correction?.event_type}
                >
                  {["clock_in", "break_start", "break_end", "clock_out"].map(
                    (t) => (
                      <option key={t} value={t}>
                        {t.replaceAll("_", " ")}
                      </option>
                    ),
                  )}
                </Select>
                <Field
                  label="Local date and time"
                  name="time"
                  type="datetime-local"
                  step="1"
                  defaultValue={
                    correction
                      ? localInput(
                          correction.occurred_at,
                          data.business.timezone,
                        )
                      : ""
                  }
                  required
                />
                <Select label="Repeated DST hour" name="dst">
                  <option value="reject">Ask if ambiguous</option>
                  <option value="earlier">First occurrence</option>
                  <option value="later">Second occurrence</option>
                </Select>
                <Field label="Reason" name="reason" required minLength={3} />
                {correction && (
                  <label className="rt-check">
                    <input name="void" type="checkbox" />
                    Void this event
                  </label>
                )}
                <button>Record correction</button>
                {correction && (
                  <Button onClick={() => setCorrection(null)}>Cancel</Button>
                )}
              </form>
              <details>
                <summary>Correction audit history</summary>
                {data.corrections.map((c) => (
                  <p key={c.id}>
                    {format(c.created_at)} · {c.reason} · actor {c.actor_id}
                    {c.void ? " · voided" : ""}
                  </p>
                ))}
              </details>
            </section>
          </>
        )}
        {tab === "Settings" && (
          <Settings data={data} owner={owner} mutate={mutate} />
        )}
      </fieldset>
      <footer className="rt-footer">
        Reimage Tech · Shift Planner{" "}
        <span>All times shown in {data.business.timezone} · USD</span>
      </footer>
    </main>
  );
}
function Settings({ data, owner, mutate }) {
  const b = data.business,
    l = data.location;
  return (
    <div className="rt-columns">
      <section className="rt-panel">
        <h2>Business settings</h2>
        <p>
          Confirm these settings before your first schedule. Timezone and
          workweek lock once records exist.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const p = values(e);
            mutate("settings", {
              ...p,
              paid_breaks: p.paid_breaks === "on",
              geofence: p.geofence === "on",
            });
          }}
        >
          <fieldset disabled={!owner}>
            <Field
              label="Business name"
              name="name"
              defaultValue={b.name}
              required
            />
            <Field
              label="Timezone"
              name="timezone"
              defaultValue={b.timezone}
              required
            />
            <Select
              label="Workweek starts"
              name="week_start"
              defaultValue={b.week_start}
            >
              {days.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
            <Field
              label="Attendance alert tolerance (minutes)"
              name="tolerance_minutes"
              type="number"
              min="0"
              max="60"
              defaultValue={b.tolerance_minutes ?? 5}
              required
            />
            <Field
              label="Shift matching window (minutes)"
              name="matching_window_minutes"
              type="number"
              min="15"
              max="720"
              defaultValue={b.matching_window_minutes ?? 240}
              required
            />
            <p>
              Tolerance changes alerts only. Recorded times and wages are never
              rounded to the schedule.
            </p>
            <div className="rt-form-grid">
              <Field
                label="Weekly overtime after (hours)"
                name="overtime_hours"
                type="number"
                min="1"
                max="168"
                step="0.5"
                defaultValue={b.overtime_hours}
                required
              />
              <Field
                label="Overtime multiplier"
                name="overtime_multiplier"
                type="number"
                min="1"
                max="5"
                step="0.1"
                defaultValue={b.overtime_multiplier}
                required
              />
              <Field
                label="Weekly labor budget (USD)"
                name="weekly_budget"
                type="number"
                min="0"
                step="0.01"
                defaultValue={b.weekly_budget ?? ""}
              />
              <Field
                label="Target labor percentage"
                name="target_labor_percent"
                type="number"
                min="1"
                max="100"
                defaultValue={b.target_labor_percent}
                required
              />
              <Field
                label="Minimum coverage"
                name="minimum_staff"
                type="number"
                min="1"
                max="100"
                defaultValue={b.minimum_staff}
                required
              />
              <Field
                label="Opening time"
                name="opening_time"
                type="time"
                defaultValue={b.opening_time.slice(0, 5)}
                required
              />
              <Field
                label="Closing time"
                name="closing_time"
                type="time"
                defaultValue={b.closing_time.slice(0, 5)}
                required
              />
            </div>
            <label className="rt-check">
              <input
                name="paid_breaks"
                type="checkbox"
                defaultChecked={b.paid_breaks}
              />
              Pay recorded breaks (future breaks only)
            </label>
            <h3>Workplace clock location</h3>
            <Field
              label="Location name"
              name="location_name"
              defaultValue={l.name}
              required
            />
            <label className="rt-check">
              <input
                name="geofence"
                type="checkbox"
                defaultChecked={l.geofence}
              />
              Require location verification for clock actions
            </label>
            <div className="rt-form-grid">
              <Field
                label="Latitude"
                name="latitude"
                type="number"
                step="any"
                min="-90"
                max="90"
                defaultValue={l.latitude ?? ""}
              />
              <Field
                label="Longitude"
                name="longitude"
                type="number"
                step="any"
                min="-180"
                max="180"
                defaultValue={l.longitude ?? ""}
              />
              <Field
                label="Allowed radius (meters)"
                name="radius_m"
                type="number"
                min="20"
                max="5000"
                defaultValue={l.radius_m}
                required
              />
              <Field
                label="Maximum GPS uncertainty (meters)"
                name="accuracy_m"
                type="number"
                min="1"
                max="500"
                defaultValue={l.accuracy_m}
                required
              />
            </div>
            <p>
              Location is checked at each action, never continuously. Manager
              corrections handle missed punches and location failures.
              Cost-setting changes reset prior approvals for review.
            </p>
            <button>Save settings</button>
          </fieldset>
        </form>
      </section>
      <section className="rt-panel">
        <h2>Manager access</h2>
        <p>
          Managers must first create a client portal account. They can manage
          this business using the owner's pilot access.
        </p>
        {data.members.map((m) => (
          <div className="rt-person" key={m.user_id}>
            <div>
              <strong>{m.email}</strong>
              <small>{m.role}</small>
            </div>
            {owner && m.role !== "owner" && (
              <Button
                onClick={() =>
                  mutate(
                    "manager",
                    { email: m.email, remove: true },
                    "Manager removed",
                  )
                }
              >
                Remove
              </Button>
            )}
          </div>
        ))}
        {owner && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutate("manager", values(e), "Manager added");
            }}
          >
            <Field label="Manager email" type="email" name="email" required />
            <button>Add manager</button>
          </form>
        )}
      </section>
    </div>
  );
}
