import fs from "fs";
import path from "path";
import { defineConfig } from "vite";

loadLocalEnv(["../.env.local", "../.env", ".env.local", ".env"]);

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
  plugins: [pricingAssistantMarketApi()],
  build: {
    outDir: "dist",
  },
});

function pricingAssistantMarketApi() {
  return {
    name: "pricing-assistant-market-api",
    configureServer(server) {
      server.middlewares.use("/api/pricing-assistant/market/latest", async (req, res) => {
        try {
          const snapshot = await buildM2Snapshot();
          sendJson(res, 200, snapshot);
        } catch (error) {
          sendJson(res, error.status || 500, {
            error: error.message || "Server error while fetching Pricing Assistant market data",
            details: error.details,
          });
        }
      });

      server.middlewares.use("/api/pricing-assistant/fred-m2", async (req, res) => {
        try {
          const data = await fetchFredObservations("M2SL");
          sendJson(res, 200, data);
        } catch (error) {
          sendJson(res, error.status || 500, {
            error: error.message || "Server error while fetching Pricing Assistant M2 data",
            details: error.details,
          });
        }
      });
    },
  };
}

async function buildM2Snapshot() {
  const m2Data = await fetchFredObservations("M2SL");
  const yoy = calculateYearOverYear(m2Data.observations);
  if (!yoy) {
    const error = new Error("Not enough M2 observations returned from FRED");
    error.status = 502;
    throw error;
  }

  return {
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
}

async function fetchFredObservations(seriesId) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    const error = new Error("Missing FRED_API_KEY environment variable");
    error.status = 500;
    throw error;
  }

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
    seriesId
  )}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=asc`;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    const error = new Error("FRED request failed");
    error.status = response.status;
    error.details = text;
    throw error;
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

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function loadLocalEnv(files) {
  for (const file of files) {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
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
