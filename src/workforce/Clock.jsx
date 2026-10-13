import React, { useEffect, useRef, useState } from "react";
import { displayTime } from "./model.mjs";
import "./workforce.css";
const labels = {
  clock_in: "Clock in",
  break_start: "Start break",
  break_end: "End break",
  clock_out: "Clock out",
};
export default function Clock({ supabase }) {
  const tag = new URLSearchParams(window.location.search).get("tag") || "";
  const key = "reimage.clock." + tag;
  const [token, setToken] = useState(() => {
      try {
        return localStorage.getItem(key) || "";
      } catch {
        return "";
      }
    }),
    [state, setState] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(null),
    [pending, setPending] = useState("");
  const request = useRef(null);
  async function call(action, p = {}) {
    if (!supabase)
      throw Error(
        "The employee clock is not configured. Contact your manager.",
      );
    const { data, error } = await supabase.functions.invoke("time-clock", {
      body: { action, tag, token, ...p },
    });
    if (error) {
      let detail;
      try {
        detail = await error.context.json();
      } catch {}
      throw Error(
        detail?.error ||
          "Connection failed. No clock action is confirmed. Check your connection and retry.",
      );
    }
    if (data?.error) throw Error(data.error);
    return data;
  }
  async function refresh() {
    const s = await call("state");
    setState(s);
    if (s.status === "enrollment_required" && token) {
      localStorage.removeItem(key);
      setToken("");
    }
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [token]);
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function punch() {
    if (!request.current || request.current.type !== pending)
      request.current = { type: pending, id: crypto.randomUUID() };
    let location = {};
    if (state.geofence) {
      if (!navigator.geolocation)
        throw Error(
          "Location is unavailable. Contact your manager for a correction.",
        );
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(
          resolve,
          () =>
            reject(
              Error(
                "Location could not be verified. Allow location access, move near the workplace, and retry. Your manager can record a correction.",
              ),
            ),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        ),
      );
      location = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        captured_at: new Date(pos.timestamp).toISOString(),
      };
    }
    const r = await call("punch", {
      event_type: pending,
      request_id: request.current.id,
      ...location,
    });
    if (!r.event) {
      await refresh();
      throw Error("Your phone must be enrolled before recording time.");
    }
    setSuccess(r.event);
    request.current = null;
    setPending("");
    await refresh();
  }
  const actions =
    state?.state === "off"
      ? ["clock_in"]
      : state?.state === "break"
        ? ["break_end", "clock_out"]
        : ["break_start", "clock_out"];
  return (
    <main className="rt-clock">
      <a className="rt-brand" href="/">
        reimage<span>tech</span>
      </a>
      <section className="rt-panel">
        <span className="rt-kicker">EMPLOYEE TIME CLOCK</span>
        <h1>{state?.business || "Welcome to work."}</h1>
        <p>{state?.location || "Tap your workplace tag to get started."}</p>
        {error && (
          <div role="alert" className="rt-error">
            {error}
            <button type="button" disabled={busy} onClick={() => act(refresh)}>
              Refresh clock
            </button>
          </div>
        )}
        {!state && !error && <p role="status">Checking clock…</p>}
        {state?.status === "enrollment_required" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const code = new FormData(e.currentTarget).get("code");
              act(async () => {
                const r = await call("enroll", {
                  code: String(code).trim().toUpperCase(),
                });
                if (!r.token)
                  throw Error(
                    "Enrollment did not complete. Ask your manager for a new code.",
                  );
                localStorage.setItem(key, r.token);
                setToken(r.token);
              });
            }}
          >
            <h2>Connect your phone</h2>
            <p>
              Enter the one-time code from your manager. This browser will
              remember you. Use only your own phone.
            </p>
            <label>
              Enrollment code
              <input
                name="code"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={10}
                minLength={10}
                required
              />
            </label>
            <button disabled={busy}>
              {busy ? "Connecting…" : "Enroll this phone"}
            </button>
          </form>
        )}
        {state?.status === "ready" && (
          <>
            <h2>{state.employee}</h2>
            <p className="rt-clock-state">
              {state.state === "off"
                ? "You are off shift"
                : state.state === "break"
                  ? "You are on break"
                  : "You are clocked in"}
            </p>
            {success && (
              <div className="rt-success" role="status">
                <strong>{labels[success.event_type]} recorded</strong>
                <p>{displayTime(success.occurred_at, state.timezone)}</p>
              </div>
            )}
            {state.geofence && (
              <p>
                Location is checked when you confirm an action. Allow location
                access when prompted.
              </p>
            )}
            {pending ? (
              <div className="rt-confirm">
                <h3>Confirm {labels[pending].toLowerCase()}?</h3>
                <button disabled={busy} onClick={() => act(punch)}>
                  {busy
                    ? "Recording…"
                    : `Confirm ${labels[pending].toLowerCase()}`}
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setPending("");
                    request.current = null;
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="rt-clock-actions">
                {actions
                  .filter(
                    (a) =>
                      state.entitled || ["break_end", "clock_out"].includes(a),
                  )
                  .map((a) => (
                    <button
                      key={a}
                      disabled={busy}
                      onClick={() => {
                        setPending(a);
                        setSuccess(null);
                        setError("");
                      }}
                    >
                      {labels[a]}
                    </button>
                  ))}
              </div>
            )}
            {!state.entitled && (
              <p>
                Business access is paused. You can finish an open shift; ask
                your manager about new clock-ins.
              </p>
            )}
            <h3>Your published schedule</h3>
            {state.schedule.length ? (
              state.schedule.map((s, i) => (
                <p key={i}>
                  {displayTime(s.starts_at, state.timezone)}
                  <br />
                  to {displayTime(s.ends_at, state.timezone)}
                  {s.planned_break_minutes > 0 && (
                    <small>
                      Planned break: {s.planned_break_minutes} min{" "}
                      {s.planned_break_paid ? "paid" : "unpaid"} from{" "}
                      {displayTime(s.planned_break_start, state.timezone)}.
                      Record your actual break with the buttons above.
                    </small>
                  )}
                </p>
              ))
            ) : (
              <p>No upcoming published shifts.</p>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await call("forget");
                  localStorage.removeItem(key);
                  setToken("");
                  setSuccess(null);
                })
              }
            >
              Forget this phone
            </button>
          </>
        )}
        <footer>
          Reimage Tech · {state?.timezone || "Business local time"}
          <br />A clock action is recorded only after server confirmation.
        </footer>
      </section>
    </main>
  );
}
