import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

loadLocalEnv(["../.env.local", "../.env", ".env.local", ".env"]);

const apiKey = process.env.FRED_API_KEY;
const outputPath = path.resolve("public/data/pricing-assistant/market/latest.json");

if (!apiKey) {
  throw new Error("Missing FRED_API_KEY environment variable");
}

const data = await fetchFredObservations("M2SL");
const yoy = calculateYearOverYear(data.observations);

if (!yoy) {
  throw new Error("Not enough M2 observations returned from FRED");
}

const snapshot = {
  updated_at: new Date().toISOString(),
  indicators: [
    {
      series: "M2SL",
      name: "Monetary Backdrop (M2)",
      current: yoy.latest.value,
      previous: yoy.yearAgo.value,
      change: yoy.change,
      date: yoy.latest.date,
      source: "FRED",
    },
  ],
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);

console.log(`Wrote Pricing Assistant market snapshot to ${outputPath}`);

async function fetchFredObservations(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
    seriesId
  )}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=asc`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FRED request failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function calculateYearOverYear(observations) {
  const rows = (observations || [])
    .map((row) => ({ date: row.date, value: Number.parseFloat(row.value) }))
    .filter((row) => Number.isFinite(row.value));
  if (rows.length < 13) return null;
  const latest = rows[rows.length - 1];
  const yearAgo = rows[Math.max(0, rows.length - 13)];
  if (!yearAgo?.value) return null;
  return {
    latest,
    yearAgo,
    change: ((latest.value - yearAgo.value) / yearAgo.value) * 100,
  };
}

function loadLocalEnv(files) {
  for (const file of files) {
    const filePath = path.resolve(process.cwd(), file);
    if (!fsSync.existsSync(filePath)) continue;

    const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key] !== undefined) continue;

      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}
