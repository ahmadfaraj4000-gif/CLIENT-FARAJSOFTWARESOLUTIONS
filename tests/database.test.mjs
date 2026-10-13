import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
const connectionString = process.env.REIMAGE_TEST_DATABASE_URL;
test(
  "workforce integration: two isolated businesses, clock lifecycle, corrections and imports",
  { skip: !connectionString },
  async (t) => {
    const pool = new pg.Pool({ connectionString });
    const raw = (sql, args = []) => pool.query(sql, args);
    async function rpc(user, name, args, role = "authenticated") {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(
          "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
          [
            user || "",
            JSON.stringify({ sub: user, email: user + "@test.invalid" }),
          ],
        );
        await c.query("set local role " + role);
        const result = await c.query(
          `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
          args,
        );
        await c.query("commit");
        return result.rows[0].result;
      } catch (e) {
        await c.query("rollback");
        throw e;
      } finally {
        c.release();
      }
    }
    const a = randomUUID(),
      b = randomUUID(),
      manager = randomUUID();
    let ba, bb, emp, tag, token, code;
    try {
      for (const id of [a, b, manager])
        await raw("insert into auth.users(id,email) values($1,$2)", [
          id,
          id + "@test.invalid",
        ]);
      for (const id of [a, b])
        await raw(
          "insert into subscriptions(user_id,product,status) values($1,'shift_planner','active')",
          [id],
        );
      ba = (
        await rpc(a, "rt_manage", [
          null,
          "create_business",
          { name: "Pilot A", timezone: "America/New_York" },
        ])
      ).id;
      bb = (
        await rpc(b, "rt_manage", [
          null,
          "create_business",
          { name: "Pilot B", timezone: "America/New_York" },
        ])
      ).id;
      emp = (
        await rpc(a, "rt_manage", [
          ba,
          "employee",
          { name: "Alex Worker", role: "Service", rate: 20, max_hours: 40 },
        ])
      ).id;
      tag = (await rpc(a, "rt_dashboard", [ba])).location.tag;
      const clock = (action, p = {}) =>
        rpc(null, "rt_clock", [action, { tag, token, ...p }], "service_role");
      await t.test("managed pilot cannot be self-activated through the trial endpoint", async () => {
        await assert.rejects(rpc(manager,"start_product_trial",["shift_planner"]), /managed pilot/);
      });
      await t.test("tenant isolation is enforced at the database", async () => {
        await assert.rejects(rpc(b, "rt_dashboard", [ba]), /denied/);
        await assert.rejects(
          rpc(b, "rt_manage", [
            ba,
            "active",
            { employee_id: emp, active: false },
          ]),
          /denied/,
        );
        await assert.rejects(
          rpc(a, "rt_clock", ["state", { tag }]),
          /permission denied/,
        );
        const c = await pool.connect();
        try {
          await c.query("set role authenticated");
          await assert.rejects(
            c.query("select * from rt_events"),
            /permission denied/,
          );
          await assert.rejects(
            c.query("select * from rt_private.sessions"),
            /permission denied/,
          );
        } finally {
          await c.query("reset role");
          c.release();
        }
      });
      await t.test(
        "manager shares owner entitlement without their own subscription",
        async () => {
          await rpc(a, "rt_manage", [
            ba,
            "manager",
            { email: manager + "@test.invalid" },
          ]);
          assert.equal(
            (await rpc(manager, "rt_dashboard", [ba])).business.id,
            ba,
          );
          await assert.rejects(
            rpc(manager, "rt_manage", [
              ba,
              "manager",
              { email: b + "@test.invalid" },
            ]),
            /owner/,
          );
        },
      );
      await t.test(
        "enrollment is single-use, expires, and invalid attempts throttle",
        async () => {
          code = (
            await rpc(a, "rt_manage", [ba, "enroll", { employee_id: emp }])
          ).code;
          token = (await clock("enroll", { code, client_key: "test" })).token;
          assert.ok(token);
          assert.ok(
            (await clock("enroll", { code, client_key: "test" })).error,
          );
          for (let i = 0; i < 11; i++)
            await clock("enroll", {
              code: "FFFFFFFFFF",
              client_key: "throttle",
            });
          assert.match(
            (await clock("enroll", { code, client_key: "throttle" })).error,
            /Too many/,
          );
          assert.equal((await clock("state")).status, "ready");
          const other = (await rpc(b, "rt_dashboard", [bb])).location.tag;
          assert.equal(
            (await clock("state", { tag: other })).status,
            "enrollment_required",
          );
        },
      );
      await t.test(
        "concurrent duplicate requests record exactly one event",
        async () => {
          const id = randomUUID();
          const results = await Promise.all([
            clock("punch", { event_type: "clock_in", request_id: id }),
            clock("punch", { event_type: "clock_in", request_id: id }),
          ]);
          assert.ok(results.every((r) => r.event));
          assert.equal(results[0].event.id, results[1].event.id);
          assert.equal(
            Number(
              (
                await raw(
                  "select count(*) from rt_events where request_id=$1",
                  [id],
                )
              ).rows[0].count,
            ),
            1,
          );
        },
      );
      await t.test(
        "state transitions, breaks and server timestamps",
        async () => {
          assert.ok(
            (
              await clock("punch", {
                event_type: "clock_in",
                request_id: randomUUID(),
              })
            ).error,
          );
          for (const event_type of ["break_start", "break_end", "clock_out"]) {
            await raw(
              "update rt_events set occurred_at=occurred_at-interval '10 seconds' where employee_id=$1",
              [emp],
            );
            const result = await clock("punch", {
              event_type,
              request_id: randomUUID(),
              occurred_at: "2000-01-01",
            });
            assert.ok(result.event, result.error);
            assert.ok(
              Date.parse(result.event.occurred_at) > Date.now() - 60000,
            );
          }
          assert.equal((await clock("state")).state, "off");
        },
      );
      await t.test(
        "geofence fails closed for denied, stale and distant positions",
        async () => {
          await raw(
            "update rt_locations set geofence=true,latitude=41,longitude=-72 where business_id=$1",
            [ba],
          );
          for (const extra of [
            {},
            {
              latitude: 41,
              longitude: -72,
              accuracy: 10,
              captured_at: "2000-01-01T00:00Z",
            },
            {
              latitude: 42,
              longitude: -72,
              accuracy: 10,
              captured_at: new Date().toISOString(),
            },
          ]) {
            await raw(
              "update rt_events set occurred_at=occurred_at-interval '10 seconds' where employee_id=$1",
              [emp],
            );
            assert.ok(
              (
                await clock("punch", {
                  event_type: "clock_in",
                  request_id: randomUUID(),
                  ...extra,
                })
              ).error,
            );
          }
          const good = await clock("punch", {
            event_type: "clock_in",
            request_id: randomUUID(),
            latitude: 41,
            longitude: -72,
            accuracy: 5,
            captured_at: new Date().toISOString(),
          });
          assert.ok(good.event?.location_verified);
          await raw(
            "update rt_locations set geofence=false where business_id=$1",
            [ba],
          );
        },
      );
      await t.test(
        "manager corrections are audited and require a valid sequence",
        async () => {
          const dashboard = await rpc(a, "rt_dashboard", [ba]);
          const event = dashboard.events.at(-1);
          await assert.rejects(
            rpc(a, "rt_manage", [
              ba,
              "correction",
              {
                employee_id: emp,
                event_id: event.id,
                event_type: "break_end",
                occurred_at: event.occurred_at,
                reason: "Wrong action",
              },
            ]),
            /Invalid clock sequence/,
          );
          await rpc(a, "rt_manage", [
            ba,
            "correction",
            {
              employee_id: emp,
              event_id: event.id,
              event_type: "clock_in",
              occurred_at: new Date(Date.now() - 4000).toISOString(),
              reason: "Verified original start",
            },
          ]);
          assert.equal(
            (await rpc(a, "rt_dashboard", [ba])).corrections.length,
            1,
          );
        },
      );
      await t.test(
        "revoked/expired sessions and disabled employees cannot punch",
        async () => {
          await rpc(a, "rt_manage", [
            ba,
            "revoke_devices",
            { employee_id: emp },
          ]);
          assert.equal((await clock("state")).status, "enrollment_required");
          code = (
            await rpc(a, "rt_manage", [ba, "enroll", { employee_id: emp }])
          ).code;
          token = (await clock("enroll", { code, client_key: "replacement" }))
            .token;
          await raw(
            "update rt_private.sessions set expires_at=now()-interval '1 second' where employee_id=$1",
            [emp],
          );
          assert.equal((await clock("state")).status, "enrollment_required");
          await rpc(a, "rt_manage", [
            ba,
            "active",
            { employee_id: emp, active: false },
          ]);
          assert.ok(
            (await clock("enroll", { code, client_key: "disabled" })).error,
          );
        },
      );
      await t.test(
        "legacy import preserves originals, repeats safely and flags identity conflicts",
        async () => {
          const legacy = randomUUID();
          const payload = {
            employees: [
              {
                emp_id: "old-1",
                name: "Legacy Worker",
                role: "Service",
                wage: 18,
                max_hours: 40,
                unavailable_days: [6],
              },
            ],
            shifts: {
              one: {
                emp_id: "old-1",
                day_idx: 0,
                start: "08:00",
                end: "16:00",
              },
            },
            dailyRevenue: ["100", "", "", "", "", "", ""],
          };
          await raw(
            "insert into shift_planner_schedules(id,user_id,name,week_label,schedule_data) values($1,$2,$3,$4,$5)",
            [legacy, a, "Old week", "unknown", payload],
          );
          const imported = await rpc(a, "rt_import_schedule", [
            ba,
            legacy,
            "2026-10-05",
          ]);
          assert.equal(
            (await rpc(a, "rt_import_schedule", [ba, legacy, "2026-10-05"])).id,
            imported.id,
          );
          assert.deepEqual(
            (
              await raw(
                "select schedule_data from shift_planner_schedules where id=$1",
                [legacy],
              )
            ).rows[0].schedule_data,
            payload,
          );
          payload.employees[0].name = "Different Person";
          const other = randomUUID();
          await raw(
            "insert into shift_planner_schedules(id,user_id,schedule_data) values($1,$2,$3)",
            [other, a, payload],
          );
          await assert.rejects(
            rpc(a, "rt_import_schedule", [ba, other, "2026-10-05"]),
            /conflicting names/,
          );
        },
      );
      await t.test(
        "expired enrollment codes do not create sessions",
        async () => {
          await rpc(a, "rt_manage", [
            ba,
            "active",
            { employee_id: emp, active: true },
          ]);
          const expired = (
            await rpc(a, "rt_manage", [ba, "enroll", { employee_id: emp }])
          ).code;
          await raw(
            "update rt_private.enrollments set expires_at=now()-interval '1 second' where employee_id=$1",
            [emp],
          );
          assert.ok(
            (await clock("enroll", { code: expired, client_key: "expiry" }))
              .error,
          );
        },
      );
      await t.test(
        "historical approvals invalidate on wage changes and corrections",
        async () => {
          const person = (
            await rpc(a, "rt_manage", [
              ba,
              "employee",
              { name: "Historical Worker", rate: 20, max_hours: 40 },
            ])
          ).id;
          await rpc(a, "rt_add_rate", [
            ba,
            person,
            20,
            "2026-01-01T00:00:00Z",
            "Verified opening wage",
          ]);
          for (const [event_type, time] of [
            ["clock_in", "13:00"],
            ["break_start", "17:00"],
            ["break_end", "18:00"],
            ["clock_out", "22:00"],
          ])
            await rpc(a, "rt_manage", [
              ba,
              "correction",
              {
                employee_id: person,
                event_type,
                occurred_at: "2026-01-05T" + time + ":00Z",
                reason: "Imported signed time record",
              },
            ]);
          await rpc(a, "rt_manage", [
            ba,
            "approve",
            { employee_id: person, week_start: "2026-01-05" },
          ]);
          assert.ok(
            (await rpc(a, "rt_dashboard", [ba])).approvals.some(
              (x) => x.employee_id === person,
            ),
          );
          await rpc(a, "rt_add_rate", [
            ba,
            person,
            22,
            "2026-01-05T19:00:00Z",
            "Verified wage adjustment",
          ]);
          assert.ok(
            !(await rpc(a, "rt_dashboard", [ba])).approvals.some(
              (x) => x.employee_id === person,
            ),
          );
          await assert.rejects(
            rpc(b, "rt_add_rate", [
              ba,
              person,
              22,
              "2026-01-01T00:00:00Z",
              "Wrong business",
            ]),
            /denied/,
          );
          const schedule = (
            await rpc(a, "rt_manage", [
              ba,
              "schedule",
              { week_start: "2026-01-05", name: "Historical schedule" },
            ])
          ).id;
          const shift = {
            schedule_id: schedule,
            employee_id: person,
            starts_at: "2026-01-05T13:00:00Z",
            ends_at: "2026-01-05T22:00:00Z",
          };
          await rpc(a, "rt_manage", [ba, "shift", shift]);
          await assert.rejects(
            rpc(a, "rt_manage", [ba, "shift", shift]),
            /overlapping/,
          );
          await rpc(a, "rt_manage", [ba, "publish", { schedule_id: schedule }]);
          await assert.rejects(
            rpc(a, "rt_manage", [ba, "shift", shift]),
            /draft/,
          );
          const count = (await rpc(a, "rt_dashboard", [ba])).schedules.length;
          await assert.rejects(
            rpc(a, "rt_save_proposal", [
              ba,
              "2026-01-12",
              JSON.stringify([
                {
                  employee_id: randomUUID(),
                  starts_at: "2026-01-12T13:00:00Z",
                  ends_at: "2026-01-12T22:00:00Z",
                },
              ]),
            ]),
            /employee/,
          );
          assert.equal(
            (await rpc(a, "rt_dashboard", [ba])).schedules.length,
            count,
          );
        },
      );
      await t.test(
        "expiration blocks writes and new punches but permits finishing open shifts",
        async () => {
          await rpc(a, "rt_manage", [
            ba,
            "active",
            { employee_id: emp, active: true },
          ]);
          code = (
            await rpc(a, "rt_manage", [ba, "enroll", { employee_id: emp }])
          ).code;
          token = (await clock("enroll", { code, client_key: "final" })).token;
          await raw(
            "update subscriptions set expires_at=now()-interval '1 day' where user_id=$1",
            [a],
          );
          await assert.rejects(
            rpc(manager, "rt_manage", [
              ba,
              "schedule",
              { week_start: "2026-10-12" },
            ]),
            /expired/,
          );
          assert.ok(
            (
              await clock("punch", {
                event_type: "clock_in",
                request_id: randomUUID(),
              })
            ).error,
          );
          await raw(
            "update rt_events set occurred_at=occurred_at-interval '10 seconds' where employee_id=$1",
            [emp],
          );
          const close = await clock("punch", {
            event_type: "clock_out",
            request_id: randomUUID(),
          });
          assert.ok(close.event, close.error);
          await assert.rejects(rpc(manager, "rt_dashboard", [ba]), /expired/);
        },
      );
    } finally {
      await pool.end();
    }
  },
);
