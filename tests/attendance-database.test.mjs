import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  weekFor,
  localDate,
} from "../src/workforce/model.mjs";
const connectionString = process.env.REIMAGE_TEST_DATABASE_URL;
test(
  "attendance snapshots, review isolation, and dual-product import authorization",
  { skip: !connectionString },
  async (t) => {
    const pool = new pg.Pool({ connectionString });
    const raw = (q, a = []) => pool.query(q, a);
    async function rpc(user, name, args, role = "authenticated") {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
          user,
        ]);
        await c.query("set local role " + role);
        const out = await c.query(
          `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
          args,
        );
        await c.query("commit");
        return out.rows[0].result;
      } catch (e) {
        await c.query("rollback");
        throw e;
      } finally {
        c.release();
      }
    }
    const owner = randomUUID(),
      other = randomUUID(),
      manager = randomUUID();
    let b, emp, schedule, plan;
    try {
      for (const id of [owner, other, manager])
        await raw("insert into auth.users(id,email)values($1,$2)", [
          id,
          id + "@test.invalid",
        ]);
      for (const id of [owner, other])
        await raw(
          "insert into subscriptions(user_id,product,status)values($1,'shift_planner','active')",
          [id],
        );
      b = (
        await rpc(owner, "rt_manage", [
          null,
          "create_business",
          { name: "Snapshots", timezone: "America/New_York" },
        ])
      ).id;
      emp = (
        await rpc(owner, "rt_manage", [
          b,
          "employee",
          { name: "Test Employee", rate: 20, max_hours: 40 },
        ])
      ).id;
      schedule = (
        await rpc(owner, "rt_manage", [
          b,
          "schedule",
          { week_start: "2099-01-05", name: "Future schedule" },
        ])
      ).id;
      const shift = {
        schedule_id: schedule,
        employee_id: emp,
        starts_at: "2099-01-05T14:00Z",
        ends_at: "2099-01-05T22:00Z",
        planned_break_start: "2099-01-05T18:00Z",
        planned_break_minutes: 30,
        planned_break_paid: false,
      };
      await t.test(
        "break bounds validated and IDs persist across draft edits",
        async () => {
          await assert.rejects(
            rpc(owner, "rt_manage", [
              b,
              "shift",
              { ...shift, planned_break_minutes: 480 },
            ]),
            /rt_valid_planned_break/,
          );
          await rpc(owner, "rt_manage", [b, "shift", shift]);
          const before = (await rpc(owner, "rt_dashboard", [b])).shifts[0];
          await rpc(owner, "rt_manage", [
            b,
            "shift",
            { ...shift, id: before.id, ends_at: "2099-01-05T23:00Z" },
          ]);
          assert.equal(
            (await rpc(owner, "rt_dashboard", [b])).shifts[0].id,
            before.id,
          );
          await rpc(owner, "rt_manage", [
            b,
            "publish",
            { schedule_id: schedule },
          ]);
          plan = (await rpc(owner, "rt_dashboard", [b])).plans[0];
          assert.equal(plan.planned_break_minutes, 30);
        },
      );
      await t.test(
        "published baseline survives draft edits and keeps revision history",
        async () => {
          await rpc(owner, "rt_manage", [
            b,
            "draft",
            { schedule_id: schedule },
          ]);
          let d = await rpc(owner, "rt_dashboard", [b]);
          assert.equal(d.plans.filter((p) => p.active).length, 1);
          await rpc(owner, "rt_manage", [
            b,
            "shift",
            { ...shift, id: d.shifts[0].id },
          ]);
          d = await rpc(owner, "rt_dashboard", [b]);
          assert.equal(
            Date.parse(d.plans[0].ends_at),
            Date.parse("2099-01-05T23:00Z"),
          );
          await rpc(owner, "rt_manage", [
            b,
            "publish",
            { schedule_id: schedule },
          ]);
          d = await rpc(owner, "rt_dashboard", [b]);
          assert.equal(d.plans.length, 2);
          assert.equal(d.plans.filter((p) => p.active).length, 1);
          plan = d.plans.find((p) => p.active);
          await rpc(owner, "rt_manage", [
            b,
            "draft",
            { schedule_id: schedule },
          ]);
          await assert.rejects(
            rpc(owner, "rt_manage", [
              b,
              "delete_schedule",
              { schedule_id: schedule },
            ]),
            /history/,
          );
        },
      );
      await t.test("started published shifts cannot be rewritten", async () => {
        const old = (
          await rpc(owner, "rt_manage", [
            b,
            "schedule",
            { week_start: "2025-01-06" },
          ])
        ).id;
        await rpc(owner, "rt_manage", [
          b,
          "shift",
          {
            schedule_id: old,
            employee_id: emp,
            starts_at: "2025-01-06T14:00Z",
            ends_at: "2025-01-06T22:00Z",
          },
        ]);
        await rpc(owner, "rt_manage", [b, "publish", { schedule_id: old }]);
        await rpc(owner, "rt_manage", [b, "draft", { schedule_id: old }]);
        const s = (await rpc(owner, "rt_dashboard", [b])).shifts.find(
          (s) => s.schedule_id === old,
        );
        await assert.rejects(
          rpc(owner, "rt_manage", [
            b,
            "delete_shift",
            { schedule_id: old, id: s.id },
          ]),
          /preserved/,
        );
      });
      await t.test(
        "server checks both paid products, expiry, and membership on import",
        async () => {
          await assert.rejects(
            rpc(owner, "rt_pricing_labor", [b, "2099-01-05", "scheduled"]),
            /Pricing Assistant/,
          );
          for (const id of [owner, other, manager])
            await raw(
              "insert into subscriptions(user_id,product,status)values($1,'pricing_assistant_pro','active')",
              [id],
            );
          assert.equal(
            (
              await rpc(owner, "rt_pricing_labor", [
                b,
                "2099-01-05",
                "scheduled",
              ])
            ).business.id,
            b,
          );
          await assert.rejects(
            rpc(other, "rt_pricing_labor", [b, "2099-01-05", "scheduled"]),
            /denied/,
          );
          await rpc(owner, "rt_manage", [
            b,
            "manager",
            { email: manager + "@test.invalid" },
          ]);
          assert.equal(
            (
              await rpc(manager, "rt_pricing_labor", [
                b,
                "2099-01-05",
                "forecast",
              ])
            ).business.id,
            b,
          );
          await raw(
            "update subscriptions set current_period_end=now()-interval '1 second' where user_id=$1 and product='pricing_assistant_pro'",
            [owner],
          );
          await assert.rejects(
            rpc(owner, "rt_pricing_labor", [b, "2099-01-05", "scheduled"]),
            /Pricing Assistant/,
          );
          await raw(
            "update subscriptions set expires_at=now()-interval '1 second' where user_id=$1 and product='shift_planner'",
            [owner],
          );
          await assert.rejects(
            rpc(manager, "rt_pricing_labor", [b, "2099-01-05", "scheduled"]),
            /expired/,
          );
          await assert.rejects(rpc(owner, "rt_dashboard", [b]), /expired/);
          await raw(
            "update subscriptions set expires_at=null,current_period_end=null where user_id=$1",
            [owner],
          );
        },
      );
      await t.test(
        "review requires current evidence, audit reason and same-business plan",
        async () => {
          let d = await rpc(owner, "rt_dashboard", [b]);
          const p = {
            plan_id: plan.id,
            decision: "review",
            fingerprint: "evidence",
            revision: d.attendance_revision,
            reason: "Confirmed absence",
          };
          await assert.rejects(
            rpc(other, "rt_review_attendance", [b, p]),
            /denied/,
          );
          await assert.rejects(
            rpc(owner, "rt_review_attendance", [b, { ...p, reason: "" }]),
            /check constraint/,
          );
          await rpc(owner, "rt_review_attendance", [b, p]);
          await assert.rejects(
            rpc(owner, "rt_review_attendance", [b, p]),
            /Attendance changed/,
          );
          d = await rpc(owner, "rt_dashboard", [b]);
          assert.equal(d.attendance_reviews.length, 1);
          assert.equal(d.attendance_reviews[0].actor_id, owner);
          const otherB = (
            await rpc(other, "rt_manage", [
              null,
              "create_business",
              { name: "Isolated", timezone: "America/New_York" },
            ])
          ).id;
          const otherD = await rpc(other, "rt_dashboard", [otherB]);
          await assert.rejects(
            rpc(other, "rt_review_attendance", [
              otherB,
              { ...p, revision: otherD.attendance_revision },
            ]),
            /plan required/,
          );
        },
      );
      await t.test(
        "raw new tables are inaccessible and actual import requires approval",
        async () => {
          const c = await pool.connect();
          try {
            await c.query("set role authenticated");
            for (const table of ["rt_shift_plans", "rt_attendance_reviews"])
              await assert.rejects(
                c.query("select * from " + table),
                /permission denied/,
              );
          } finally {
            await c.query("reset role");
            c.release();
          }
          await assert.rejects(
            rpc(owner, "rt_pricing_labor", [b, "2099-01-05", "actual"]),
            /completed/,
          );
          await rpc(owner, "rt_add_rate", [
            b,
            emp,
            20,
            "2025-01-01T00:00Z",
            "Opening wage",
          ]);
          for (const [event_type, time] of [
            ["clock_in", "14:00"],
            ["clock_out", "22:00"],
          ])
            await rpc(owner, "rt_manage", [
              b,
              "correction",
              {
                employee_id: emp,
                event_type,
                occurred_at: "2025-01-06T" + time + "Z",
                reason: "Verified record",
              },
            ]);
          await assert.rejects(
            rpc(owner, "rt_pricing_labor", [b, "2025-01-06", "actual"]),
            /Approve every/,
          );
          await rpc(owner, "rt_manage", [
            b,
            "approve",
            { employee_id: emp, week_start: "2025-01-06" },
          ]);
          assert.equal(
            (await rpc(owner, "rt_pricing_labor", [b, "2025-01-06", "actual"]))
              .import_basis,
            "actual",
          );
        },
      );
      await t.test(
        "employee sees published plan during draft edits and an early punch freezes that plan",
        async () => {
          const person = (
            await rpc(owner, "rt_manage", [
              b,
              "employee",
              { name: "Early Worker", rate: 20, max_hours: 40 },
            ])
          ).id;
          const start = new Date(Date.now() + 3600000).toISOString(),
            finish = new Date(Date.now() + 9 * 3600000).toISOString();
          const w = weekFor(localDate(start, "America/New_York"), 1);
          const sid = (
            await rpc(owner, "rt_manage", [
              b,
              "schedule",
              { week_start: w, name: "Live plan" },
            ])
          ).id;
          await rpc(owner, "rt_manage", [
            b,
            "shift",
            {
              schedule_id: sid,
              employee_id: person,
              starts_at: start,
              ends_at: finish,
            },
          ]);
          await rpc(owner, "rt_manage", [b, "publish", { schedule_id: sid }]);
          await rpc(owner, "rt_manage", [b, "draft", { schedule_id: sid }]);
          const d = await rpc(owner, "rt_dashboard", [b]),
            sh = d.shifts.find((s) => s.schedule_id === sid),
            snapshot = d.plans.find((p) => p.source_shift_id === sh.id);
          const code = (
            await rpc(owner, "rt_manage", [
              b,
              "enroll",
              { employee_id: person },
            ])
          ).code;
          const tag = d.location.tag;
          const token = (
            await rpc(
              owner,
              "rt_clock",
              ["enroll", { tag, code, client_key: "early-" + owner }],
              "service_role",
            )
          ).token;
          const clock = await rpc(
            owner,
            "rt_clock",
            ["state", { tag, token }],
            "service_role",
          );
          assert.equal(clock.schedule.length, 1);
          assert.equal(clock.schedule[0].starts_at, snapshot.starts_at);
          assert.equal(clock.rates, undefined);
          const punch = await rpc(
            owner,
            "rt_clock",
            [
              "punch",
              { tag, token, event_type: "clock_in", request_id: randomUUID() },
            ],
            "service_role",
          );
          assert.ok(punch.event, punch.error);
          await assert.rejects(
            rpc(owner, "rt_manage", [
              b,
              "shift",
              {
                id: sh.id,
                schedule_id: sid,
                employee_id: person,
                starts_at: start,
                ends_at: new Date(Date.now() + 10 * 3600000).toISOString(),
              },
            ]),
            /preserved/,
          );
          await rpc(owner, "rt_manage", [b, "publish", { schedule_id: sid }]);
          assert.ok(
            (await rpc(owner, "rt_dashboard", [b])).plans.some(
              (p) => p.id === snapshot.id && p.active,
            ),
          );
        },
      );
      await t.test(
        "publishing another draft replaces future plans for that workweek",
        async () => {
          const replacement = (
            await rpc(owner, "rt_manage", [
              b,
              "schedule",
              { week_start: "2099-01-05", name: "Replacement" },
            ])
          ).id;
          await rpc(owner, "rt_manage", [
            b,
            "shift",
            {
              ...shift,
              schedule_id: replacement,
              starts_at: "2099-01-05T14:30Z",
            },
          ]);
          await rpc(owner, "rt_manage", [
            b,
            "publish",
            { schedule_id: replacement },
          ]);
          const d = await rpc(owner, "rt_dashboard", [b]);
          assert.equal(
            d.plans.filter((p) => p.active && p.schedule_id === schedule)
              .length,
            0,
          );
          assert.equal(
            d.plans.filter((p) => p.active && p.schedule_id === replacement)
              .length,
            1,
          );
          assert.ok(d.plans.some((p) => p.id === plan.id && !p.active));
        },
      );
    } finally {
      await pool.end();
    }
  },
);
