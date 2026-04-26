import React, { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import ShiftPlanner from "./ShiftPlanner";

const STRIPE_PAYMENT_LINK = "PASTE_YOUR_SHIFT_PLANNER_STRIPE_PAYMENT_LINK_HERE";

export default function ProtectedShiftPlanner() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    checkAccess();
  }, []);

  async function checkAccess() {
    setLoading(true);
    setMessage("");

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      console.error(sessionError);
      setMessage("Could not verify your login.");
      setLoading(false);
      return;
    }

    if (!session?.user) {
      setUser(null);
      setLoading(false);
      return;
    }

    setUser(session.user);

    /*
      Expected subscriptions table shape:

      subscriptions
      - id uuid primary key default gen_random_uuid()
      - user_id uuid references auth.users(id)
      - product text
      - status text
      - stripe_customer_id text
      - stripe_subscription_id text
      - current_period_end timestamptz
      - created_at timestamptz default now()
      - updated_at timestamptz default now()

      Access is allowed when:
      product = 'shift_planner'
      AND status is active/trialing/paid
      AND subscription has not expired if current_period_end exists
    */

    const { data, error } = await supabase
      .from("subscriptions")
      .select("id, user_id, product, status, current_period_end")
      .eq("user_id", session.user.id)
      .eq("product", "shift_planner")
      .in("status", ["active", "trialing", "paid"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(error);
      setMessage("Could not verify your subscription. Check the subscriptions table and RLS policy.");
      setLoading(false);
      return;
    }

    const notExpired =
      !data?.current_period_end || new Date(data.current_period_end).getTime() > Date.now();

    setHasAccess(Boolean(data && notExpired));
    setLoading(false);
  }

  async function goToStripe() {
    if (!user?.email) {
      navigate("/login");
      return;
    }

    /*
      This uses a Stripe Payment Link.
      Better final setup: create a serverless checkout function that receives the user id,
      creates Stripe Checkout, then webhook updates Supabase subscriptions.
    */
    const url = new URL(STRIPE_PAYMENT_LINK);
    url.searchParams.set("prefilled_email", user.email);
    url.searchParams.set("client_reference_id", user.id);
    window.location.href = url.toString();
  }

  if (loading) {
    return (
      <div className="portal-gate">
        <div className="portal-gate-card">Checking your Shift Planner access...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAccess) {
    return (
      <div className="portal-gate">
        <div className="portal-gate-card">
          <div className="demo-eyebrow">Subscription Required</div>
          <h1>Shift Planner is locked</h1>
          <p>
            Your account is logged in, but there is no active Shift Planner subscription attached to it yet.
          </p>

          {message && <div className="portal-status error">{message}</div>}

          <button className="small-btn primary" type="button" onClick={goToStripe}>
            Subscribe Now
          </button>

          <button className="small-btn" type="button" onClick={checkAccess}>
            I already paid — refresh access
          </button>
        </div>
      </div>
    );
  }

  return <ShiftPlanner user={user} />;
}
