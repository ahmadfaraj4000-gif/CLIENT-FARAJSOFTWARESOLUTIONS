// Disposable PostgreSQL cluster only; never connects to a configured production database.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "reimage-test-"));
const bin = process.env.POSTGRES_BIN || "/opt/homebrew/opt/postgresql@14/bin";
const port = process.env.REIMAGE_TEST_PORT || "55440";
function run(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) throw Error(`${name} failed (${result.status})`);
}
let started = false;
let vite;
try {
  run(path.join(bin, "initdb"), [
    "-D",
    dir + "/data",
    "-A",
    "trust",
    "-U",
    "postgres",
  ]);
  run(path.join(bin, "pg_ctl"), [
    "-D",
    dir + "/data",
    "-l",
    dir + "/postgres.log",
    "-o",
    `-p ${port} -h 127.0.0.1 -k ${dir}`,
    "start",
  ]);
  started = true;
  const sql = (file) =>
    run(path.join(bin, "psql"), [
      "-h",
      dir,
      "-p",
      port,
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      file,
    ]);
  sql("tests/database-bootstrap.sql");
  for (const f of readdirSync(root + "/supabase/migrations").sort())
    sql("supabase/migrations/" + f);
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      ...readdirSync(root + "/tests")
        .filter((f) => f.endsWith(".test.mjs"))
        .map((f) => "tests/" + f),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        REIMAGE_TEST_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/postgres`,
      },
    },
  );
  process.exitCode = result.status || 0;
  if (result.status === 0 && process.env.REIMAGE_RUN_BROWSER === "1") {
    const browserPort = "5188";
    vite = spawn(
      process.execPath,
      [
        root + "/node_modules/vite/bin/vite.js",
        "--host",
        "127.0.0.1",
        "--port",
        browserPort,
        "--strictPort",
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          VITE_SUPABASE_URL: "http://127.0.0.1:54399",
          VITE_SUPABASE_ANON_KEY: "local-browser-test",
        },
      },
    );
    run("curl", [
      "--retry",
      "10",
      "--retry-connrefused",
      "--retry-delay",
      "1",
      "--silent",
      "--fail",
      "-o",
      "/dev/null",
      "http://127.0.0.1:" + browserPort,
    ]);
    run(process.execPath, ["tests/browser.mjs"], {
      env: {
        ...process.env,
        REIMAGE_BROWSER_URL: "http://127.0.0.1:" + browserPort,
        REIMAGE_TEST_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/postgres`,
      },
    });
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  if (vite) vite.kill("SIGTERM");
  if (started)
    spawnSync(
      path.join(bin, "pg_ctl"),
      ["-D", dir + "/data", "stop", "-m", "fast"],
      { stdio: "inherit" },
    );
  rmSync(dir, { recursive: true, force: true });
}
