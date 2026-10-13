import React, { useEffect, useState } from "react";
import { pricingImport } from "./attendance.mjs";
import { localDate, weekFor, money } from "./model.mjs";
export default function PricingLaborImport({ supabase, onImport, onClose }) {
  const [businesses, setBusinesses] = useState([]),
    [business, setBusiness] = useState(""),
    [week, setWeek] = useState(""),
    [basis, setBasis] = useState("scheduled"),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    supabase.rpc("rt_bootstrap", {}).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const bs = data.businesses.filter((b) => b.entitled);
      setBusinesses(bs);
      if (bs.length) {
        setBusiness(bs[0].id);
        setWeek(
          weekFor(localDate(Date.now(), bs[0].timezone), bs[0].week_start),
        );
      } else
        setError(
          "Active business Shift Planner access is required. Ask the business owner to contact Reimage Tech.",
        );
    });
    return () => {
      active = false;
    };
  }, [supabase]);
  async function fetchPreview() {
    const { data, error } = await supabase.rpc("rt_pricing_labor", {
      b: business,
      w: week,
      basis,
    });
    if (error) throw Error(error.message);
    return pricingImport(data, week, basis, Date.parse(data.as_of));
  }
  async function perform(confirm = false) {
    setBusy(true);
    setError("");
    try {
      const next = await fetchPreview();
      if (confirm) {
        if (
          next.label !== preview.label ||
          Math.abs(next.cost - preview.cost) > 0.01 ||
          Math.abs(next.hours - preview.hours) > 0.01 ||
          next.uncertain !== preview.uncertain ||
          next.tiers.length !== preview.tiers.length
        ) {
          setPreview(next);
          setError(
            "Labor changed since the preview. Review the updated totals, then confirm again.",
          );
          return;
        }
        onImport(next);
      } else setPreview(next);
    } catch (e) {
      setPreview(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="pricing-panel stack pricing-labor-import"
      aria-label="Import Shift Planner labor"
    >
      <h3>Import Shift Planner labor</h3>
      <p>
        Choose the business, workweek, and source. Effective hourly costs
        include overtime and wage changes. This replaces your labor tiers after
        confirmation.
      </p>
      <fieldset disabled={busy} className="stack">
        <label>
          Business
          <select
            aria-label="Import business"
            value={business}
            onChange={(e) => {
              const b = businesses.find((b) => b.id === e.target.value);
              setBusiness(b.id);
              setWeek(weekFor(localDate(Date.now(), b.timezone), b.week_start));
              setPreview(null);
            }}
          >
            {businesses.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Workweek
          <input
            type="date"
            value={week}
            onChange={(e) => {
              const b = businesses.find((b) => b.id === business);
              setWeek(
                e.target.value ? weekFor(e.target.value, b.week_start) : "",
              );
              setPreview(null);
            }}
          />
        </label>
        <label>
          Labor source
          <select
            aria-label="Labor source"
            value={basis}
            onChange={(e) => {
              setBasis(e.target.value);
              setPreview(null);
            }}
          >
            <option value="scheduled">Published schedule</option>
            <option value="actual">Approved actual hours</option>
            <option value="forecast">Week forecast (estimate)</option>
          </select>
        </label>
        <button
          type="button"
          disabled={!business || !week}
          onClick={() => perform()}
        >
          Preview labor import
        </button>
        {preview && (
          <>
            <p>{preview.label}</p>
            <p>
              <strong>
                {preview.hours.toFixed(2)} paid hours · {money(preview.cost)}{" "}
                gross wages · {preview.tiers.length} labor tiers
              </strong>
            </p>
            {preview.uncertain && (
              <p>
                Attendance gaps make this forecast uncertain. Review the Shift
                Planner exceptions before relying on this estimate.
              </p>
            )}
            <p>
              Imported values are a snapshot. Import again to refresh after
              schedule changes or timesheet corrections.
            </p>
            <button type="button" onClick={() => perform(true)}>
              Replace labor tiers
            </button>
          </>
        )}
        <button type="button" onClick={onClose}>
          Close import
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
