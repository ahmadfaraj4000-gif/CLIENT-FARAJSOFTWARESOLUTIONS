// Browser uses a temporary local DB via intercepted RPCs; no production network or credentials.
import { chromium, expect } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
const pool = new pg.Pool({
  connectionString: process.env.REIMAGE_TEST_DATABASE_URL,
});
if (!process.env.REIMAGE_TEST_DATABASE_URL)
  throw Error(
    "REIMAGE_TEST_DATABASE_URL must point to a disposable local database",
  );
const browserUrl = process.env.REIMAGE_BROWSER_URL || "http://127.0.0.1:5173";
const id = randomUUID(),
  email = id + "@test.invalid";
await pool.query("insert into auth.users(id,email) values($1,$2)", [id, email]);
await pool.query(
  "insert into subscriptions(user_id,product,status) values($1,'shift_planner','active'),($1,'pricing_assistant_pro','active')",
  [id],
);
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const errors = [];
const token = [
  "e30",
  Buffer.from(
    JSON.stringify({
      sub: id,
      email,
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: "authenticated",
    }),
  ).toString("base64url"),
  "test",
].join(".");
await ctx.addInitScript(
  ({ token, id, email }) => {
    localStorage.setItem(
      "sb-127-auth-token",
      JSON.stringify({
        access_token: token,
        refresh_token: "test",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: "bearer",
        user: { id, email, aud: "authenticated", role: "authenticated" },
      }),
    );
  },
  { token, id, email },
);
await ctx.route("http://127.0.0.1:54399/**", async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS")
    return route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
      },
    });
  const path = new URL(request.url()).pathname;
  const p = request.postDataJSON() || {};
  if (path === "/rest/v1/subscriptions")
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          product: "pricing_assistant_pro",
          status: "active",
          current_period_end: null,
          expires_at: null,
        },
      ]),
      headers: { "access-control-allow-origin": "*" },
    });
  if (path.startsWith("/rest/v1/") && !path.includes("/rpc/"))
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
      headers: { "access-control-allow-origin": "*" },
    });
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [id, JSON.stringify({ sub: id, email })],
    );
    const clock = path.includes("/functions/v1/");
    await c.query(
      "set local role " + (clock ? "service_role" : "authenticated"),
    );
    const name = clock ? "rt_clock" : path.split("/").at(-1);
    if (!/^rt_[a-z_]+$/.test(name)) throw Error("Unexpected API " + path);
    const args = clock
      ? { action: p.action, p: { ...p, client_key: "browser" } }
      : p;
    const names = Object.keys(args);
    if (!names.every((n) => /^[a-z_]+$/.test(n)))
      throw Error("Invalid argument");
    const r = await c.query(
      `select ${name}(${names.map((n, i) => `${n} => $${i + 1}`).join(",")}) as result`,
      Object.values(args).map((v) =>
        Array.isArray(v) ? JSON.stringify(v) : v,
      ),
    );
    await c.query("commit");
    await route.fulfill({
      status: r.rows[0].result?.error ? 400 : 200,
      contentType: "application/json",
      body: JSON.stringify(r.rows[0].result),
      headers: { "access-control-allow-origin": "*" },
    });
  } catch (e) {
    await c.query("rollback");
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: e.message, error: e.message }),
      headers: { "access-control-allow-origin": "*" },
    });
  } finally {
    c.release();
  }
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await fs.mkdir("artifacts", { recursive: true });
try {
  await page.goto(browserUrl + "/?app=shift-planner");
  await page.getByLabel("Business name").fill("Northside Service Co.");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "A clearer view of your week." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Employees", exact: true }).click();
  for (const name of ["Alex Morgan", "Sam Rivera"]) {
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Role", { exact: true }).fill("Service team");
    await page.getByLabel("Hourly wage (USD)").fill("24");
    await page.getByRole("button", { name: "Save employee" }).click();
    await expect(
      page.locator(".rt-person").getByText(name, { exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page.getByRole("button", { name: "Suggest a schedule" }).click();
  await expect(
    page.getByRole("heading", { name: "Review suggested schedule" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept as draft" }).click();
  await expect(
    page.getByText("Suggested draft saved", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".rt-shift")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("Planned break (minutes)").fill("30");
  await page.getByRole("button", { name: "Update shift", exact: true }).click();
  await expect(page.getByText("Shift updated", { exact: true })).toBeVisible();
  await pool.query(
    "insert into rt_rates(business_id,employee_id,effective_at,rate) select business_id,id,'2000-01-01',24 from rt_employees where business_id=(select id from rt_businesses where owner_id=$1)",
    [id],
  );
  await page
    .getByRole("button", { name: "Publish schedule", exact: true })
    .click();
  await expect(
    page.getByText("Schedule published", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/schedule-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Time Clock", exact: true }).click();
  await expect(
    page.getByAltText("QR code for this business's employee clock"),
  ).toBeVisible();
  const clockUrl = await page.getByLabel("NFC tag URL").inputValue();
  await page.getByRole("button", { name: "Create code" }).first().click();
  const code = await page.locator(".rt-code code").innerText();
  const phone = await ctx.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(clockUrl);
  await phone.getByLabel("Enrollment code").fill(code);
  await phone.getByRole("button", { name: "Enroll this phone" }).click();
  await expect(
    phone.getByRole("heading", { name: "Alex Morgan" }),
  ).toBeVisible();
  await phone.getByRole("button", { name: "Clock in", exact: true }).click();
  await phone.getByRole("button", { name: "Confirm clock in" }).click();
  await expect(
    phone.getByText("Clock in recorded", { exact: true }),
  ).toBeVisible();
  await phone.screenshot({
    path: "artifacts/clock-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A clearer view of your week." }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/overview-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Timesheets", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Worked time & labor" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Schedule vs attendance" }),
  ).toBeVisible();
  await page.getByLabel("Show all shifts and reviewed exceptions").check();
  await page
    .getByRole("button", { name: "Review attendance", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Review reason")
    .fill("Verified with manager during pilot test");
  await page.getByRole("button", { name: "Save attendance review" }).click();
  await expect(
    page.getByText("Attendance review saved; timesheet approval reset", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/attendance-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/attendance-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
  )
    throw Error("Attendance mobile overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  await (await download).saveAs("artifacts/timesheets.csv");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Weekly labor budget (USD)").fill("1600");
  await page.getByLabel("Attendance alert tolerance (minutes)").fill("7");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({
    path: "artifacts/overview-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
  )
    throw Error("Mobile page overflows viewport");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ctx.route("**/api/**", (r) =>
    r.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.goto(browserUrl + "/?app=pricing-assistant");
  await expect(page.locator(".pricing-app")).toBeVisible();
  await page.getByRole("button", { name: /Cost Structure/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Import from Shift Planner" }).click();
  await page.getByRole("button", { name: "Preview labor import" }).click();
  await expect(
    page.getByRole("button", { name: "Replace labor tiers" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/pricing-labor-import.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/pricing-labor-import-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
  )
    throw Error("Pricing import mobile overflow");
  await page.getByRole("button", { name: "Replace labor tiers" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByText(/Labor source: Northside Service Co/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import from Shift Planner" }).click();
  await page.getByLabel("Labor source", { exact: true }).selectOption("actual");
  await page.getByRole("button", { name: "Preview labor import" }).click();
  await expect(page.getByRole("alert")).toContainText("completed workweek");
  await page
    .getByLabel("Labor source", { exact: true })
    .selectOption("forecast");
  await pool.query(
    "update subscriptions set expires_at=now()-interval '1 day' where user_id=$1 and product='pricing_assistant_pro'",
    [id],
  );
  await page.getByRole("button", { name: "Preview labor import" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Pricing Assistant access",
  );
  await page.getByRole("button", { name: "Close import" }).click();
  await page.screenshot({
    path: "artifacts/pricing-assistant-desktop.png",
    fullPage: true,
  });
  await page.goto(browserUrl + "/?app=shift-planner");
  await expect(
    page.getByRole("heading", { name: "A clearer view of your week." }),
  ).toBeVisible();
  await pool.query(
    "update subscriptions set expires_at=now()-interval '1 day' where user_id=$1 and product='shift_planner'",
    [id],
  );
  await expect(page.getByRole("status")).toContainText("access has expired", {
    timeout: 40000,
  });
  await expect(
    page.getByRole("heading", { name: "A clearer view of your week." }),
  ).toHaveCount(0);
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: onboarding, roster, suggested draft, publication, QR, phone enrollment, clock-in, reports, planned breaks, attendance review, settings, responsive layouts, pricing labor import, dual-product paywall.",
  );
} catch (e) {
  await page.screenshot({
    path: "artifacts/browser-failure.png",
    fullPage: true,
  });
  console.error(await page.locator("body").innerText());
  throw e;
} finally {
  await browser.close();
  await pool.end();
}
