import React, { useEffect, useMemo, useRef, useState } from "react";
import "./PricingAssistant.css";
import PRICING_TEMPLATES from "./pricingAssistantTemplates.json";

const MARKET_DATA_URLS = [
  import.meta.env.VITE_PRICING_ASSISTANT_MARKET_API,
  "/api/pricing-assistant/market/latest",
  "/api/market/latest",
  `${import.meta.env.BASE_URL}data/pricing-assistant/market/latest.json`,
].filter(Boolean);

const FRED_M2_URLS = [
  import.meta.env.VITE_PRICING_ASSISTANT_FRED_M2_API,
  "/api/pricing-assistant/fred-m2",
  "/api/fred?series_id=M2SL",
].filter(Boolean);

const UNITS = ["lb", "oz", "g", "kg", "ml", "l", "floz", "gal", "each", "count"];

const WEIGHT_TO_G = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
const VOLUME_TO_ML = { ml: 1, l: 1000, floz: 29.5735295625, gal: 3785.411784 };
const COUNT_UNITS = new Set(["each", "count", "unit", "pc", "pcs"]);

const EMPTY_INGREDIENT = {
  name: "",
  purchase_price: "",
  purchase_qty: "",
  purchase_unit: "lb",
  recipe_qty_used: "",
  recipe_unit: "oz",
  waste_pct: "0",
};

const DEFAULT_FORM = {
  item_name: "Burger",
  default_waste_pct: "0.05",
  labor_hourly_rate: "18",
  labor_minutes_per_item: "4",
  prep_time_hours: "0",
  prep_time_minutes: "40",
  batch_yield: "10",
  labor_mode: "batch",
  monthly_overhead: "0",
  monthly_units_sold: "600",
  target_margin: "0.20",
  current_price: "12.99",
  competitor_prices: ["11.99", "13.49", "14.99"],
  auto_min_viable: true,
  min_viable_margin: "0.10",
  premium_positioning: false,
  premium_cap_over_comp_max_pct: "0.10",
};

const DEFAULT_APP_FEES = [
  { name: "DoorDash", pct: "15.0" },
  { name: "Uber Eats", pct: "0.0" },
  { name: "Grubhub", pct: "0.0" },
];

const DEFAULT_CC_FEES = [
  { name: "Visa/MC Debit", pct: "0.5" },
  { name: "Visa/MC Credit", pct: "2.6" },
  { name: "Amex", pct: "3.0" },
  { name: "Other / POS", pct: "0.0" },
];

const DEFAULT_OVERHEAD = [
  "Rent / Lease",
  "Insurance",
  "Internet",
  "Utilities (electric/gas/water)",
  "Phone",
  "Software subscriptions",
  "Accounting / Bookkeeping",
  "Legal",
  "Licenses / Permits",
  "Marketing / Ads",
  "Repairs / Maintenance",
  "Cleaning / Janitorial",
  "Security",
  "Waste removal",
  "Office supplies",
  "POS / Payment processing",
  "Vehicle / Transport",
  "Storage",
  "Bank / Merchant fees",
  "Other",
].map((name) => ({ name, monthly_cost: "0" }));

const STARTER_INGREDIENTS = [
  ["Ground Beef (80/20)", 6.5, 1, "lb", 6, "oz", 0.05],
  ["Brioche Bun", 4.5, 8, "count", 1, "count", 0],
  ["American Cheese", 5.8, 16, "oz", 0.75, "oz", 0],
  ["Lettuce/Tomato/Onion", 1.8, 1, "lb", 2, "oz", 0.12],
  ["Special Sauce", 3.2, 32, "floz", 0.5, "floz", 0],
  ["Pickles", 2.4, 32, "floz", 0.25, "floz", 0],
].map(([name, purchase_price, purchase_qty, purchase_unit, recipe_qty_used, recipe_unit, waste_pct]) => ({
  name,
  purchase_price: String(purchase_price),
  purchase_qty: String(purchase_qty),
  purchase_unit,
  recipe_qty_used: String(recipe_qty_used),
  recipe_unit,
  waste_pct: String(waste_pct),
}));

const STARTER_OVERHEAD = [
  ["Rent / Lease", 3500],
  ["Utilities (electric/gas/water)", 600],
  ["Insurance", 250],
  ["POS / Payment processing", 80],
  ["Cleaning / Janitorial", 150],
  ["Marketing / Ads", 200],
  ["Licenses / Permits", 75],
  ["Repairs / Maintenance", 100],
].map(([name, monthly_cost]) => ({ name, monthly_cost: String(monthly_cost) }));

const STARTER_PACKAGING = [{ name: "Burger Bag", pack_price: "8.00", pack_qty: "50", used_per_item: "1" }];

const WORKSPACE_NAV = [
  { id: "setup", label: "Price Item", eyebrow: "Current item" },
  { id: "advanced", label: "Cost Structure", eyebrow: "Labor, overhead, fees" },
  { id: "market", label: "Market Guidance", eyebrow: "Competitors and M2" },
  { id: "scenario", label: "What-if", eyebrow: "Stress test" },
  { id: "templates", label: "Templates", eyebrow: "Recipe library" },
  { id: "menus", label: "Menus", eyebrow: "Saved work" },
];

const AUTOSAVE_COST_NAME = "Autosaved Costs";
const DRAFT_VERSION = 1;
const NO_ACTIVE_COST_PROFILE = "Name a cost profile";

function normalizeUnit(unit) {
  return String(unit || "")
    .trim()
    .toLowerCase()
    .replace("fl oz", "floz")
    .replace("fl_oz", "floz")
    .replace("fluid ounce", "floz")
    .replace("pounds", "lb")
    .replace("pound", "lb")
    .replace("ounces", "oz")
    .replace("ounce", "oz")
    .replace("grams", "g")
    .replace("gram", "g")
    .replace("kilograms", "kg")
    .replace("kilogram", "kg")
    .replace("liters", "l")
    .replace("liter", "l")
    .replace("gallons", "gal")
    .replace("gallon", "gal");
}

function unitType(unit) {
  const u = normalizeUnit(unit);
  if (WEIGHT_TO_G[u]) return "weight";
  if (VOLUME_TO_ML[u]) return "volume";
  if (COUNT_UNITS.has(u)) return "count";
  return null;
}

function convert(value, fromUnit, toUnit) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  const fromType = unitType(from);
  const toType = unitType(to);
  if (!fromType || !toType || fromType !== toType) return null;
  if (fromType === "weight") return (value * WEIGHT_TO_G[from]) / WEIGHT_TO_G[to];
  if (fromType === "volume") return (value * VOLUME_TO_ML[from]) / VOLUME_TO_ML[to];
  return value;
}

function num(value, fallback = 0) {
  const parsed = parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return "$" + Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return `${Number(value).toFixed(1)}%`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function ingredientCost(ingredient, defaultWastePct) {
  const purchasePrice = Math.max(0, num(ingredient.purchase_price));
  const purchaseQty = Math.max(0, num(ingredient.purchase_qty));
  const recipeQty = Math.max(0, num(ingredient.recipe_qty_used));
  if (!purchasePrice || !purchaseQty || !recipeQty) return { food: 0, waste: 0, error: "" };

  const convertedQty = convert(purchaseQty, ingredient.purchase_unit, ingredient.recipe_unit);
  if (!convertedQty || convertedQty <= 0) {
    return { food: 0, waste: 0, error: `Unit mismatch for ${ingredient.name || "ingredient"}` };
  }

  const baseCost = (purchasePrice / convertedQty) * recipeQty;
  const wastePct = num(ingredient.waste_pct) > 0 ? num(ingredient.waste_pct) : Math.max(0, defaultWastePct);
  return { food: baseCost, waste: baseCost * Math.max(0, wastePct), error: "" };
}

function calculatePricing(inputs) {
  let foodCost = 0;
  let wasteCost = 0;
  const ingredientRows = [];
  const errors = [];

  inputs.ingredients.forEach((ingredient) => {
    const result = ingredientCost(ingredient, inputs.default_waste_pct);
    foodCost += result.food;
    wasteCost += result.waste;
    if (result.error) errors.push(result.error);
    ingredientRows.push({
      name: ingredient.name || "Ingredient",
      food: result.food,
      waste: result.waste,
      total: result.food + result.waste,
    });
  });

  const laborCost =
    inputs.labor_hourly_rate > 0 && inputs.labor_minutes_per_item > 0
      ? (inputs.labor_hourly_rate / 60) * inputs.labor_minutes_per_item
      : 0;
  const overheadCost =
    inputs.monthly_overhead > 0 && inputs.monthly_units_sold > 0
      ? inputs.monthly_overhead / inputs.monthly_units_sold
      : 0;
  const trueCost = foodCost + wasteCost + laborCost + overheadCost;
  const totalFeePct = Math.max(0, inputs.cc_fee_pct) + Math.max(0, inputs.app_fee_pct);
  const feeDivisor = Math.max(1 - totalFeePct, 0.05);
  const breakEvenPrice = trueCost > 0 ? trueCost / feeDivisor : 0;
  const margin = clamp(inputs.target_margin, 0, 0.95);
  const recommendedPrice = breakEvenPrice > 0 ? breakEvenPrice / Math.max(1 - margin, 0.05) : 0;

  let profitAtCurrent = null;
  let marginAtCurrent = null;
  if (inputs.current_price && inputs.current_price > 0) {
    profitAtCurrent = inputs.current_price - trueCost;
    marginAtCurrent = inputs.current_price > 0 ? (profitAtCurrent / inputs.current_price) * 100 : 0;
  }

  let status = null;
  if (inputs.current_price && recommendedPrice > 0) {
    if (inputs.current_price < recommendedPrice * 0.93) status = "UNDERPRICED";
    else if (inputs.current_price > recommendedPrice * 1.07) status = "OVERPRICED";
    else status = "ON TARGET";
  }

  const competitorPrices = inputs.competitor_prices.filter((price) => price > 0);
  let competitorMin = null;
  let competitorMax = null;
  let competitorAvg = null;
  let competitorRows = [];
  let competitiveProfitablePrice = null;
  let maxMarginIfMatchCompAvg = null;

  if (trueCost > 0 && competitorPrices.length) {
    competitorMin = Math.min(...competitorPrices);
    competitorMax = Math.max(...competitorPrices);
    competitorAvg = competitorPrices.reduce((sum, price) => sum + price, 0) / competitorPrices.length;
    competitorRows = competitorPrices.map((price) => ({
      price,
      profit: price - trueCost,
      margin_pct: price > 0 ? ((price - trueCost) / price) * 100 : 0,
    }));

    let suggested = competitorAvg;
    if (inputs.auto_min_viable) {
      suggested = Math.max(suggested, trueCost / Math.max(1 - inputs.min_viable_margin, 0.05));
    }
    if (inputs.premium_positioning) {
      const cap = competitorMax * (1 + Math.max(0, inputs.premium_cap_over_comp_max_pct));
      suggested = Math.min(Math.max(suggested, Math.min(recommendedPrice, cap)), cap);
    } else {
      suggested = Math.min(suggested, competitorMax);
    }
    competitiveProfitablePrice = suggested;
    maxMarginIfMatchCompAvg = competitorAvg > 0 ? ((competitorAvg - trueCost) / competitorAvg) * 100 : null;
  }

  return {
    foodCost,
    wasteCost,
    laborCost,
    overheadCost,
    trueCost,
    breakEvenPrice,
    recommendedPrice,
    profitAtCurrent,
    marginAtCurrent,
    status,
    competitorMin,
    competitorMax,
    competitorAvg,
    competitorRows,
    competitiveProfitablePrice,
    maxMarginIfMatchCompAvg,
    ingredientRows,
    errors,
  };
}

function applyScenario(inputs, scenario) {
  const copy = JSON.parse(JSON.stringify(inputs));
  const globalPct = num(scenario.global_ingredient_price_pct);
  if (globalPct) {
    copy.ingredients = copy.ingredients.map((ingredient) => ({
      ...ingredient,
      purchase_price: String(num(ingredient.purchase_price) * (1 + globalPct)),
    }));
  }
  const name = String(scenario.specific_ingredient_name || "").trim().toLowerCase();
  const specificPct = num(scenario.specific_ingredient_price_pct);
  if (name && specificPct) {
    copy.ingredients = copy.ingredients.map((ingredient) =>
      String(ingredient.name || "").trim().toLowerCase() === name
        ? { ...ingredient, purchase_price: String(num(ingredient.purchase_price) * (1 + specificPct)) }
        : ingredient
    );
  }
  copy.labor_hourly_rate = Math.max(0, copy.labor_hourly_rate + num(scenario.labor_delta_per_hour));
  copy.monthly_overhead = Math.max(0, copy.monthly_overhead * (1 + num(scenario.overhead_pct)));
  copy.monthly_units_sold = Math.max(0, copy.monthly_units_sold * (1 + num(scenario.volume_pct)));
  return copy;
}

function blankMenu(name = "My Menu") {
  return {
    id: crypto.randomUUID(),
    menu_name: name,
    created_at_iso: new Date().toISOString(),
    items: [],
  };
}

function buildM2Signal(observations, recommendedPrice) {
  const valid = (observations || [])
    .map((row) => ({ date: row.date, value: num(row.value, NaN) }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0);

  if (valid.length < 13) {
    return {
      loading: false,
      available: false,
      label: "M2 unavailable",
      summary: "M2 data is not available from the market signal endpoint right now.",
      action: "Use your cost-based recommendation until the macro signal loads.",
      yoyChange: null,
      suggestedLift: 0,
      suggestedPrice: recommendedPrice,
      latestDate: null,
    };
  }

  const latest = valid[valid.length - 1];
  const yearAgo = valid[Math.max(0, valid.length - 13)];
  const yoyChange = ((latest.value - yearAgo.value) / yearAgo.value) * 100;
  let label = "M2 backdrop calm";
  let action = "No broad monetary price bump is suggested from M2 alone.";
  let summary = "Money supply growth is not adding much long-range pricing pressure.";
  let suggestedLift = 0;

  if (yoyChange >= 8) {
    label = "M2 expansionary";
    suggestedLift = clamp(yoyChange * 0.45, 2, 6);
    summary = "M2 is expanding quickly enough to suggest warmer long-range purchasing-power pressure.";
    action = `Review pricing with a ${suggestedLift.toFixed(1)}% macro cushion if demand and competitors allow it.`;
  } else if (yoyChange >= 3) {
    label = "M2 supportive";
    suggestedLift = clamp(yoyChange * 0.3, 1, 3);
    summary = "M2 is growing enough to justify disciplined, incremental pricing reviews.";
    action = `Consider a ${suggestedLift.toFixed(1)}% review cushion on items already near your target margin.`;
  }

  return {
    loading: false,
    available: true,
    label,
    summary,
    action,
    yoyChange,
    suggestedLift,
    suggestedPrice: recommendedPrice * (1 + suggestedLift / 100),
    latestDate: latest.date,
  };
}

function buildM2SignalFromSnapshot(snapshot, recommendedPrice) {
  const indicators = Array.isArray(snapshot?.indicators) ? snapshot.indicators : [];
  const m2 = indicators.find((indicator) => String(indicator.series || "").toUpperCase() === "M2SL");
  const yoyChange = num(m2?.change, NaN);

  if (!m2 || !Number.isFinite(yoyChange)) {
    return buildM2Signal([], recommendedPrice);
  }

  let label = "M2 backdrop calm";
  let action = "No broad monetary price bump is suggested from M2 alone.";
  let summary = "Money supply growth is not adding much long-range pricing pressure.";
  let suggestedLift = 0;

  if (yoyChange >= 8) {
    label = "M2 expansionary";
    suggestedLift = clamp(yoyChange * 0.45, 2, 6);
    summary = "M2 is expanding quickly enough to suggest warmer long-range purchasing-power pressure.";
    action = `Review pricing with a ${suggestedLift.toFixed(1)}% macro cushion if demand and competitors allow it.`;
  } else if (yoyChange >= 3) {
    label = "M2 supportive";
    suggestedLift = clamp(yoyChange * 0.3, 1, 3);
    summary = "M2 is growing enough to justify disciplined, incremental pricing reviews.";
    action = `Consider a ${suggestedLift.toFixed(1)}% review cushion on items already near your target margin.`;
  }

  return {
    loading: false,
    available: true,
    label,
    summary,
    action,
    yoyChange,
    suggestedLift,
    suggestedPrice: recommendedPrice * (1 + suggestedLift / 100),
    latestDate: snapshot?.updated_at || m2.date || null,
  };
}

export default function PricingAssistant({ user, supabase, tier = "standard" }) {
  const isPro = tier === "pro";
  const [form, setForm] = useState(DEFAULT_FORM);
  const [ingredients, setIngredients] = useState(STARTER_INGREDIENTS);
  const [laborTiers, setLaborTiers] = useState([]);
  const [overheadItems, setOverheadItems] = useState(STARTER_OVERHEAD);
  const [packaging, setPackaging] = useState(STARTER_PACKAGING);
  const [appFees, setAppFees] = useState(DEFAULT_APP_FEES);
  const [ccFees, setCcFees] = useState(DEFAULT_CC_FEES);
  const [scenario, setScenario] = useState({
    global_ingredient_price_pct: "0.00",
    specific_ingredient_name: "",
    specific_ingredient_price_pct: "0.00",
    labor_delta_per_hour: "0.00",
    overhead_pct: "0.00",
    volume_pct: "0.00",
  });
  const [menus, setMenus] = useState([]);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [activeMenuItemIndex, setActiveMenuItemIndex] = useState(null);
  const [costConfigs, setCostConfigs] = useState([]);
  const [activeCostConfigId, setActiveCostConfigId] = useState(null);
  const [activeCostConfigName, setActiveCostConfigName] = useState("");
  const [savedDataLoaded, setSavedDataLoaded] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [activeTab, setActiveTab] = useState("setup");
  const [templateSearch, setTemplateSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [shiftPlannerAccess, setShiftPlannerAccess] = useState({ loading: true, active: false });
  const menusRef = useRef([]);
  const lastAutoCostSignatureRef = useRef("");
  const lastAutoMenuSignatureRef = useRef("");
  const [m2Signal, setM2Signal] = useState({
    loading: true,
    available: false,
    label: "Loading M2",
    summary: "Checking the monetary backdrop.",
    action: "Recommendation will update when M2 loads.",
    yoyChange: null,
    suggestedLift: 0,
    suggestedPrice: 0,
    latestDate: null,
  });

  useEffect(() => {
    if (!user?.id || !supabase) {
      setSavedDataLoaded(true);
      setShiftPlannerAccess({ loading: false, active: false });
      return;
    }
    hydrateLocalDraft(user.id);
    loadSavedData();
    loadShiftPlannerAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    menusRef.current = menus;
  }, [menus]);

  useEffect(() => {
    let cancelled = false;
    async function loadM2() {
      for (const url of MARKET_DATA_URLS) {
        try {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) throw new Error("Market snapshot request failed");
          const data = await response.json();
          if (!cancelled) {
            setM2Signal(buildM2SignalFromSnapshot(data, baseline.recommendedPrice));
          }
          return;
        } catch {
          // Try the next configured snapshot URL.
        }
      }

      for (const url of FRED_M2_URLS) {
        try {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) throw new Error("FRED M2 request failed");
          const data = await response.json();
          if (!cancelled) {
            setM2Signal(buildM2Signal(data.observations, baseline.recommendedPrice));
          }
          return;
        } catch {
          // Try the next configured FRED proxy URL.
        }
      }

      if (!cancelled) {
        setM2Signal(buildM2Signal([], baseline.recommendedPrice));
      }
    }
    loadM2();
    return () => {
      cancelled = true;
    };
    // baseline is intentionally omitted so a price edit does not refetch FRED.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const packagingCost = useMemo(
    () =>
      packaging.reduce((sum, item) => {
        const qty = num(item.pack_qty, 1);
        return sum + (qty > 0 ? (num(item.pack_price) / qty) * num(item.used_per_item, 1) : 0);
      }, 0),
    [packaging]
  );

  const weightedLabor = useMemo(() => {
    const valid = laborTiers.filter((tierItem) => num(tierItem.wage) > 0 && num(tierItem.hours_per_week) > 0);
    const hours = valid.reduce((sum, tierItem) => sum + num(tierItem.hours_per_week), 0);
    const weighted = valid.reduce((sum, tierItem) => sum + num(tierItem.wage) * num(tierItem.hours_per_week), 0);
    return {
      hours,
      rate: hours > 0 ? weighted / hours : null,
    };
  }, [laborTiers]);

  const overheadTotal = useMemo(
    () => overheadItems.reduce((sum, item) => sum + Math.max(0, num(item.monthly_cost)), 0),
    [overheadItems]
  );

  const blendedAppFee = useMemo(() => blendedFee(appFees), [appFees]);
  const blendedCcFee = useMemo(() => blendedFee(ccFees), [ccFees]);

  const builtInputs = useMemo(() => {
    const laborMinutes =
      form.labor_mode === "batch"
        ? batchMinutes(form.prep_time_hours, form.prep_time_minutes, form.batch_yield)
        : Math.max(0, num(form.labor_minutes_per_item));
    const baseOverhead = overheadTotal > 0 ? overheadTotal : Math.max(0, num(form.monthly_overhead));
    const units = Math.max(0, num(form.monthly_units_sold));
    return {
      item_name: form.item_name || "Menu Item",
      ingredients,
      labor_hourly_rate: weightedLabor.rate ?? Math.max(0, num(form.labor_hourly_rate)),
      labor_minutes_per_item: laborMinutes,
      monthly_overhead: baseOverhead + packagingCost * units,
      monthly_units_sold: units,
      target_margin: Math.max(0, num(form.target_margin, 0.2)),
      current_price: form.current_price ? Math.max(0, num(form.current_price)) : null,
      default_waste_pct: Math.max(0, num(form.default_waste_pct)),
      competitor_prices: form.competitor_prices.map((price) => num(price)).filter((price) => price > 0),
      auto_min_viable: form.auto_min_viable,
      min_viable_margin: Math.max(0, num(form.min_viable_margin, 0.1)),
      premium_positioning: form.premium_positioning,
      premium_cap_over_comp_max_pct: Math.max(0, num(form.premium_cap_over_comp_max_pct, 0.1)),
      cc_fee_pct: blendedCcFee,
      app_fee_pct: isPro ? blendedAppFee : 0,
    };
  }, [form, ingredients, weightedLabor.rate, overheadTotal, packagingCost, blendedAppFee, blendedCcFee, isPro]);

  const baseline = useMemo(() => calculatePricing(builtInputs), [builtInputs]);
  const whatIfInputs = useMemo(() => applyScenario(builtInputs, scenario), [builtInputs, scenario]);
  const whatIf = useMemo(() => calculatePricing(whatIfInputs), [whatIfInputs]);
  const currentM2Signal = useMemo(
    () =>
      m2Signal.available
        ? { ...m2Signal, suggestedPrice: baseline.recommendedPrice * (1 + m2Signal.suggestedLift / 100) }
        : { ...m2Signal, suggestedPrice: baseline.recommendedPrice },
    [m2Signal, baseline.recommendedPrice]
  );

  useEffect(() => {
    setForm((current) => {
      const next = { ...current };
      let changed = false;

      if (weightedLabor.rate !== null) {
        const laborRate = formatNumberForInput(weightedLabor.rate);
        if (current.labor_hourly_rate !== laborRate) {
          next.labor_hourly_rate = laborRate;
          changed = true;
        }
      }

      if (overheadTotal > 0) {
        const monthlyOverhead = formatNumberForInput(overheadTotal);
        if (current.monthly_overhead !== monthlyOverhead) {
          next.monthly_overhead = monthlyOverhead;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [weightedLabor.rate, overheadTotal]);

  useEffect(() => {
    if (!savedDataLoaded) return;
    const handle = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          draftStorageKey(user?.id),
          JSON.stringify({
            version: DRAFT_VERSION,
            form,
            ingredients,
            laborTiers,
            overheadItems,
            packaging,
            appFees,
            ccFees,
            scenario,
            activeMenuId,
            activeMenuItemIndex,
            activeCostConfigId,
            activeCostConfigName,
          })
        );
      } catch {
        // Local draft autosave is best-effort; Supabase saves still run below.
      }
    }, 400);

    return () => window.clearTimeout(handle);
  }, [
    savedDataLoaded,
    user?.id,
    form,
    ingredients,
    laborTiers,
    overheadItems,
    packaging,
    appFees,
    ccFees,
    scenario,
    activeMenuId,
    activeMenuItemIndex,
    activeCostConfigId,
    activeCostConfigName,
  ]);

  useEffect(() => {
    if (!savedDataLoaded || !activeCostConfigName.trim()) return;
    const config = buildCostConfig(activeCostConfigName.trim(), {
      id: activeCostConfigId || slugId(activeCostConfigName),
      laborTiers,
      overheadItems,
      appFees,
      ccFees,
      packaging,
      form,
    });
    const signature = JSON.stringify(config);
    if (signature === lastAutoCostSignatureRef.current) return;

    const handle = window.setTimeout(() => {
      lastAutoCostSignatureRef.current = signature;
      persistCostConfig(config, { dbId: activeCostConfigId, quiet: true, makeActive: true });
    }, 1200);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedDataLoaded, laborTiers, overheadItems, appFees, ccFees, packaging, form, activeCostConfigId, activeCostConfigName]);

  useEffect(() => {
    if (!savedDataLoaded || activeMenuItemIndex === null || !activeMenuId) return;
    const menu = menusRef.current.find((item) => item.id === activeMenuId || item.db_id === activeMenuId);
    if (!menu?.items?.[activeMenuItemIndex]) return;

    const nextItem = serializeCurrentItem(builtInputs, {
      appFees,
      ccFees,
      laborTiers,
      overheadItems,
      packaging,
      form,
    });
    const signature = JSON.stringify({ activeMenuId, activeMenuItemIndex, nextItem });
    if (signature === lastAutoMenuSignatureRef.current) return;

    const handle = window.setTimeout(() => {
      const currentMenu = menusRef.current.find((item) => item.id === activeMenuId || item.db_id === activeMenuId);
      if (!currentMenu?.items?.[activeMenuItemIndex]) return;
      const nextItems = [...currentMenu.items];
      nextItems[activeMenuItemIndex] = nextItem;
      lastAutoMenuSignatureRef.current = signature;
      persistMenu({ ...currentMenu, items: nextItems, updated_at: new Date().toISOString() }, { quiet: true });
    }, 1500);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedDataLoaded, activeMenuId, activeMenuItemIndex, builtInputs, appFees, ccFees, laborTiers, overheadItems, packaging, form]);

  const templateItems = useMemo(() => {
    const term = templateSearch.trim().toLowerCase();
    return PRICING_TEMPLATES.flatMap((template) =>
      template.items.map((item) => ({ ...item, cuisineName: template.name, cuisineId: template.id }))
    ).filter((item) => {
      if (!term) return true;
      return [item.item_name, item.category, item.cuisineName]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [templateSearch]);

  const savedCostConfigs = useMemo(
    () => costConfigs.filter((config) => config.name && config.name !== AUTOSAVE_COST_NAME),
    [costConfigs]
  );

  const modalTemplateItems = useMemo(() => {
    const term = String(modal?.search || "").trim().toLowerCase();
    return PRICING_TEMPLATES.flatMap((template) =>
      template.items.map((item) => ({ ...item, cuisineName: template.name, cuisineId: template.id }))
    ).filter((item) => {
      if (!term) return true;
      return [item.item_name, item.category, item.cuisineName].join(" ").toLowerCase().includes(term);
    }).slice(0, 48);
  }, [modal?.search]);

  async function loadSavedData() {
    const [menusRes, configsRes] = await Promise.all([
      supabase.from("pricing_assistant_menus").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
      supabase.from("pricing_assistant_cost_configs").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
    ]);

    if (menusRes.error || configsRes.error) {
      setStatusMessage("Saved Pricing Assistant tables are not available yet. You can still use the calculator in this session.");
      setSavedDataLoaded(true);
      return;
    }

    setMenus((menusRes.data || []).map((row) => ({ ...row.payload, db_id: row.id })));
    const configs = (configsRes.data || []).map((row) => ({ ...row.payload, db_id: row.id, config_name: row.config_name }));
    setCostConfigs(configs);
    const firstNamedConfig = configs.find((config) => config.name && config.name !== AUTOSAVE_COST_NAME);
    if (firstNamedConfig && !activeCostConfigName) {
      setActiveCostConfigId(firstNamedConfig.db_id || firstNamedConfig.id);
      setActiveCostConfigName(firstNamedConfig.name);
    }
    setSavedDataLoaded(true);
  }

  async function loadShiftPlannerAccess() {
    if (!supabase || !user?.id) {
      setShiftPlannerAccess({ loading: false, active: false });
      return false;
    }

    setShiftPlannerAccess((current) => ({ ...current, loading: true }));
    const { data, error } = await supabase
      .from("subscriptions")
      .select("product, status, current_period_end, expires_at")
      .eq("user_id", user.id)
      .eq("product", "shift_planner")
      .in("status", ["active", "trialing", "paid"]);

    if (error) {
      setShiftPlannerAccess({ loading: false, active: false, error: error.message });
      return false;
    }

    const active = (data || []).some((sub) => {
      return (
        (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now()) &&
        (!sub.expires_at || new Date(sub.expires_at).getTime() > Date.now())
      );
    });

    setShiftPlannerAccess({ loading: false, active });
    return active;
  }

  function hydrateLocalDraft(userId) {
    try {
      const draft = JSON.parse(window.localStorage.getItem(draftStorageKey(userId)) || "null");
      if (!draft || draft.version !== DRAFT_VERSION) return;
      if (draft.form) setForm((current) => ({ ...current, ...draft.form }));
      if (Array.isArray(draft.ingredients)) setIngredients(draft.ingredients);
      if (Array.isArray(draft.laborTiers)) setLaborTiers(draft.laborTiers);
      if (Array.isArray(draft.overheadItems)) setOverheadItems(draft.overheadItems);
      if (Array.isArray(draft.packaging)) setPackaging(draft.packaging);
      if (Array.isArray(draft.appFees)) setAppFees(draft.appFees);
      if (Array.isArray(draft.ccFees)) setCcFees(draft.ccFees);
      if (draft.scenario) setScenario((current) => ({ ...current, ...draft.scenario }));
      if (draft.activeMenuId) setActiveMenuId(draft.activeMenuId);
      if (draft.activeMenuItemIndex !== undefined) setActiveMenuItemIndex(draft.activeMenuItemIndex);
      if (draft.activeCostConfigId) setActiveCostConfigId(draft.activeCostConfigId);
      if (draft.activeCostConfigName) setActiveCostConfigName(draft.activeCostConfigName);
    } catch {
      // Corrupt drafts are ignored so users can keep working.
    }
  }

  async function persistMenu(menu, options = {}) {
    if (!supabase || !user?.id) {
      setMenus((current) => upsertById(current, menu));
      return;
    }

    const payload = { ...menu };
    const dbId = payload.db_id;
    delete payload.db_id;
    const row = {
      id: dbId,
      user_id: user.id,
      menu_name: menu.menu_name,
      payload,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("pricing_assistant_menus")
      .upsert(row)
      .select("*")
      .single();

    if (error) {
      if (!options.quiet) setStatusMessage(error.message);
      setMenus((current) => upsertById(current, menu));
      return;
    }

    const saved = { ...data.payload, db_id: data.id };
    setMenus((current) => upsertById(current, saved));
  }

  async function saveCostConfig() {
    setModal({
      type: "cost-name",
      title: activeCostConfigName ? "Rename Cost Profile" : "Name Cost Profile",
      value: activeCostConfigName || "Restaurant Costs",
    });
  }

  async function saveNamedCostConfig(name) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return;
    const config = buildCostConfig(cleanName, {
      id: activeCostConfigId || slugId(cleanName),
      laborTiers,
      overheadItems,
      appFees,
      ccFees,
      packaging,
      form,
    });
    await persistCostConfig(config, { dbId: activeCostConfigId, makeActive: true });
    setModal(null);
  }

  async function persistCostConfig(config, options = {}) {
    if (supabase && user?.id) {
      const row = {
        user_id: user.id,
        config_name: config.name,
        payload: config,
        updated_at: new Date().toISOString(),
      };
      if (options.dbId) row.id = options.dbId;

      const { data, error } = await supabase
        .from("pricing_assistant_cost_configs")
        .upsert(row)
        .select("*")
        .single();
      if (error) {
        if (!options.quiet) setStatusMessage(error.message);
      } else {
        const saved = { ...data.payload, db_id: data.id };
        setCostConfigs((current) => upsertById(current, saved));
        if (options.makeActive) {
          setActiveCostConfigId(data.id);
          setActiveCostConfigName(saved.name);
        }
        if (!options.quiet) setStatusMessage(`Saved cost configuration: ${config.name}`);
        return;
      }
    }

    setCostConfigs((current) => upsertById(current, config));
    if (options.makeActive) {
      setActiveCostConfigId(config.db_id || config.id);
      setActiveCostConfigName(config.name);
    }
    if (!options.quiet) setStatusMessage(`Saved cost configuration: ${config.name}`);
  }

  function recallCostConfig(config) {
    setLaborTiers(config.labor_tiers || []);
    setOverheadItems(config.overhead_items || []);
    setPackaging(config.packaging?.length ? config.packaging : STARTER_PACKAGING);
    setAppFees(config.app_fees?.length ? config.app_fees : DEFAULT_APP_FEES);
    setCcFees(config.cc_fees?.length ? config.cc_fees : DEFAULT_CC_FEES);
    if (config.cost_form) {
      setForm((current) => ({ ...current, ...config.cost_form }));
    }
    setActiveCostConfigId(config.db_id || config.id);
    setActiveCostConfigName(config.name || "");
    setStatusMessage(`Loaded cost configuration: ${config.name}`);
  }

  async function deleteCostConfig(config) {
    if (supabase && user?.id && config.db_id) {
      const { error } = await supabase
        .from("pricing_assistant_cost_configs")
        .delete()
        .eq("id", config.db_id)
        .eq("user_id", user.id);
      if (error) {
        setStatusMessage(error.message);
        return;
      }
    }

    setCostConfigs((current) => current.filter((item) => (item.db_id || item.id) !== (config.db_id || config.id)));
    if ((activeCostConfigId === config.db_id || activeCostConfigId === config.id) && activeCostConfigName === config.name) {
      setActiveCostConfigId(null);
      setActiveCostConfigName("");
    }
    setModal(null);
    setStatusMessage(`Deleted cost profile: ${config.name}`);
  }

  async function importLaborTiersFromShiftPlanner() {
    if (!supabase || !user?.id) {
      setStatusMessage("Sign in to import labor tiers from Shift Planner.");
      return;
    }

    const hasAccess = shiftPlannerAccess.active || (await loadShiftPlannerAccess());
    if (!hasAccess) {
      setStatusMessage("Shift Planner access is required before importing labor tiers.");
      return;
    }

    const { data, error } = await supabase
      .from("shift_planner_schedules")
      .select("name, schedule_data, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      setStatusMessage("Could not load Shift Planner schedules. Check the Shift Planner tables and RLS policies.");
      return;
    }

    const schedule = data?.[0];
    const employees = schedule?.schedule_data?.employees;
    if (!Array.isArray(employees) || employees.length === 0) {
      setStatusMessage("No employees found in your latest Shift Planner schedule.");
      return;
    }

    const shifts = schedule.schedule_data?.shifts || {};
    const hoursByEmployee = {};
    Object.values(shifts).forEach((shift) => {
      if (!shift?.emp_id) return;
      hoursByEmployee[shift.emp_id] = (hoursByEmployee[shift.emp_id] || 0) + shiftHoursForImport(shift.start, shift.end);
    });

    const grouped = new Map();
    employees.forEach((employee) => {
      const wage = num(employee.wage);
      if (!wage) return;
      const role = employee.role || "Staff";
      const hours = hoursByEmployee[employee.emp_id] || num(employee.max_hours || employee.max);
      const key = `${role}-${wage}`;
      const current = grouped.get(key) || { role, wage, hours_per_week: 0 };
      current.hours_per_week += hours || 0;
      grouped.set(key, current);
    });

    const tiers = Array.from(grouped.values()).map((tier) => ({
      role: tier.role,
      wage: formatNumberForInput(tier.wage),
      hours_per_week: formatNumberForInput(tier.hours_per_week),
    }));

    if (!tiers.length) {
      setStatusMessage("No hourly wages were found in your latest Shift Planner schedule.");
      return;
    }

    setLaborTiers(tiers);
    setActiveTab("advanced");
    setStatusMessage(`Imported ${tiers.length} labor tier${tiers.length === 1 ? "" : "s"} from ${schedule.name || "Shift Planner"}.`);
  }

  function updateIngredient(index, patch) {
    setIngredients((current) => current.map((ingredient, i) => (i === index ? { ...ingredient, ...patch } : ingredient)));
  }

  function startNewItem() {
    setModal({ type: "new-item-template", title: "Start New Item" });
  }

  function resetNewItem() {
    setForm((current) => ({
      ...current,
      item_name: "New Item",
      current_price: "",
      competitor_prices: ["", "", ""],
      labor_minutes_per_item: DEFAULT_FORM.labor_minutes_per_item,
      prep_time_hours: DEFAULT_FORM.prep_time_hours,
      prep_time_minutes: DEFAULT_FORM.prep_time_minutes,
      batch_yield: DEFAULT_FORM.batch_yield,
      labor_mode: DEFAULT_FORM.labor_mode,
    }));
    setIngredients([{ ...EMPTY_INGREDIENT }]);
    setActiveMenuItemIndex(null);
  }

  function continueNewItemToCosts() {
    setModal({ type: "new-item-costs", title: "Recall Saved Costs" });
  }

  function skipNewItemCosts() {
    setModal(null);
    setActiveTab("setup");
    setStatusMessage("Started a new item. Existing cost assumptions are still applied.");
  }

  function selectNewItemCostConfig(config) {
    recallCostConfig(config);
    setModal(null);
    setActiveTab("setup");
  }

  function openTemplateStep() {
    setModal({ type: "template-picker", title: "Choose Template", search: "" });
  }

  function addToMenu() {
    setModal({ type: "add-to-menu", title: "Add to Menu" });
  }

  function currentSerializedItem() {
    return serializeCurrentItem(builtInputs, {
      appFees,
      ccFees,
      laborTiers,
      overheadItems,
      packaging,
      form,
    });
  }

  function addCurrentItemToMenu(menu) {
    const item = currentSerializedItem();
    const nextMenu = {
      ...menu,
      items: [...(menu.items || []), item],
      updated_at: new Date().toISOString(),
    };
    setActiveMenuId(nextMenu.id);
    persistMenu(nextMenu);
    setModal(null);
    setStatusMessage(`Added ${item.item_name} to ${nextMenu.menu_name}.`);
  }

  function createMenu() {
    setModal({ type: "menu-name", title: "Create Menu", value: "My Menu" });
  }

  function createNamedMenu(name, options = {}) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return;
    const menu = blankMenu(cleanName);
    if (options.addCurrentItem) {
      menu.items = [currentSerializedItem()];
      menu.updated_at = new Date().toISOString();
    }
    setActiveMenuId(menu.id);
    persistMenu(menu);
    setModal(null);
    if (options.addCurrentItem) {
      setStatusMessage(`Created ${menu.menu_name} and added ${menu.items[0].item_name}.`);
    }
  }

  async function deleteMenu(menu) {
    if (supabase && user?.id && menu.db_id) {
      const { error } = await supabase
        .from("pricing_assistant_menus")
        .delete()
        .eq("id", menu.db_id)
        .eq("user_id", user.id);
      if (error) {
        setStatusMessage(error.message);
        return;
      }
    }

    setMenus((current) => current.filter((item) => (item.db_id || item.id) !== (menu.db_id || menu.id)));
    if ((activeMenuId === menu.id || activeMenuId === menu.db_id) && activeMenuItemIndex !== null) {
      setActiveMenuId(null);
      setActiveMenuItemIndex(null);
    }
    setModal(null);
    setStatusMessage(`Deleted ${menu.menu_name}.`);
  }

  async function deleteMenuItem(menu, itemIndex) {
    const existingItems = menu.items || [];
    const removedItem = existingItems[itemIndex];
    if (!removedItem) return;

    const nextItems = existingItems.filter((_, index) => index !== itemIndex);
    const nextMenu = { ...menu, items: nextItems, updated_at: new Date().toISOString() };
    await persistMenu(nextMenu);

    const sameMenu = activeMenuId === menu.id || activeMenuId === menu.db_id;
    if (sameMenu && activeMenuItemIndex === itemIndex) {
      setActiveMenuItemIndex(null);
    } else if (sameMenu && activeMenuItemIndex !== null && activeMenuItemIndex > itemIndex) {
      setActiveMenuItemIndex(activeMenuItemIndex - 1);
    }

    setModal(null);
    setStatusMessage(`Deleted ${removedItem.item_name || "item"} from ${menu.menu_name}.`);
  }

  function loadMenuItem(menu, index) {
    const item = menu.items[index];
    if (!item) return;
    setForm({ ...DEFAULT_FORM, ...(item.ui?.form || {}), ...deserializeForm(item) });
    setIngredients(item.ingredients || []);
    setLaborTiers(item.ui?.laborTiers || []);
    setOverheadItems(item.ui?.overheadItems || []);
    setPackaging(item.ui?.packaging || []);
    setAppFees(item.ui?.appFees || DEFAULT_APP_FEES);
    setCcFees(item.ui?.ccFees || DEFAULT_CC_FEES);
    setActiveMenuId(menu.id);
    setActiveMenuItemIndex(index);
    setStatusMessage(`Loaded ${item.item_name} from ${menu.menu_name}.`);
  }

  function saveBackToMenu() {
    const menu = menus.find((item) => item.id === activeMenuId);
    if (!menu || activeMenuItemIndex === null) return;
    const nextItems = [...menu.items];
    nextItems[activeMenuItemIndex] = serializeCurrentItem(builtInputs, {
      appFees,
      ccFees,
      laborTiers,
      overheadItems,
      packaging,
      form,
    });
    persistMenu({ ...menu, items: nextItems, updated_at: new Date().toISOString() });
    setStatusMessage(`Saved ${nextItems[activeMenuItemIndex].item_name} back to ${menu.menu_name}.`);
  }

  function exportCsv(menu) {
    const rows = [
      [
        "item_name",
        "true_cost",
        "recommended_price",
        "competitive_price",
        "current_price",
        "profit_per_item_at_current",
        "margin_pct_at_current",
        "food_cost",
        "waste_cost",
        "labor_cost",
        "overhead_cost",
        "monthly_units_sold",
        "monthly_profit_estimate",
        "target_margin",
        "ingredient_count",
      ],
    ];
    (menu.items || []).forEach((item) => {
      const result = calculatePricing(normalizeSavedItem(item));
      const monthlyProfit =
        item.current_price && result.profitAtCurrent !== null
          ? result.profitAtCurrent * num(item.monthly_units_sold)
          : "";
      rows.push([
        item.item_name,
        result.trueCost,
        result.recommendedPrice,
        result.competitiveProfitablePrice || result.recommendedPrice,
        item.current_price || "",
        result.profitAtCurrent ?? "",
        result.marginAtCurrent ?? "",
        result.foodCost,
        result.wasteCost,
        result.laborCost,
        result.overheadCost,
        item.monthly_units_sold,
        monthlyProfit,
        item.target_margin,
        item.ingredients?.length || 0,
      ]);
    });
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${menu.menu_name.replace(/\s+/g, "_")}_export.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function useTemplate(templateItem, options = {}) {
    const cuisine = PRICING_TEMPLATES.find((template) => template.items.some((item) => item.item_name === templateItem.item_name));
    const commonIngredients = cuisine?.common_ingredients || [];
    setForm((current) => ({
      ...current,
      item_name: templateItem.item_name,
      labor_minutes_per_item: String(templateItem.labor_minutes || current.labor_minutes_per_item),
      current_price: String(templateItem.suggested_price || ""),
      labor_mode: "manual",
    }));
    setIngredients(
      templateItem.ingredients.map((ingredient) => {
        const normalized = Array.isArray(ingredient)
          ? {
              name: ingredient[0],
              purchase_unit: ingredient[1],
              recipe_qty: ingredient[2],
              recipe_unit: ingredient[3],
              waste_pct: ingredient[4],
            }
          : ingredient;
        const common = commonIngredients.find((item) => item.name === normalized.name);
        return {
        ...EMPTY_INGREDIENT,
        name: normalized.name,
        purchase_qty: "1",
        purchase_unit: common?.purchase_unit || normalized.purchase_unit || "lb",
        recipe_qty_used: String(normalized.recipe_qty || 0),
        recipe_unit: normalized.recipe_unit || common?.recipe_unit || "oz",
        waste_pct: String(common?.typical_waste_pct ?? normalized.waste_pct ?? 0),
      };
      })
    );
    setActiveMenuItemIndex(null);
    if (options.continueToCosts) {
      continueNewItemToCosts();
    } else {
      setStatusMessage(`Loaded ${templateItem.item_name}. Enter your purchase prices to finish costing it.`);
    }
  }

  return (
    <div className="pricing-app">
      <aside className="pricing-sidebar">
        <div className="pricing-brand-block">
          <div className="pricing-logo">PA</div>
          <div>
            <strong>Pricing Assistant Pro</strong>
            <span>Menu engineering</span>
          </div>
        </div>

        <nav className="pricing-nav" aria-label="Pricing Assistant sections">
          {WORKSPACE_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeTab === item.id ? "active" : ""}
              onClick={() => {
                setActiveTab(item.id);
                if (item.id === "advanced" && !activeCostConfigName) {
                  setModal({ type: "cost-name", title: "Name Cost Profile", value: "Restaurant Costs" });
                }
              }}
            >
              <span>{item.label}</span>
              <small>{item.eyebrow}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-summary">
          <span>Recommended</span>
          <strong>{money(baseline.recommendedPrice)}</strong>
          <small>{baseline.status || "Live calculation"}</small>
        </div>
      </aside>

      <main className="pricing-main">
        <header className="pricing-toolbar">
          <div>
            <div className="demo-eyebrow">Pricing Workspace</div>
            <h1>{form.item_name || "Menu Item"}</h1>
          </div>
          <div className="pricing-toolbar-actions">
            <a className="portal-return-link" href="/">Software Dashboard</a>
            <button type="button" onClick={startNewItem}>New Item</button>
            <button type="button" onClick={addToMenu}>Add to Menu</button>
            {activeMenuItemIndex !== null && <button type="button" onClick={saveBackToMenu}>Save Changes</button>}
          </div>
        </header>

        {statusMessage && <div className="pricing-status">{statusMessage}</div>}

        <section className="current-item-strip">
          <label>
            <span>Item name</span>
            <input value={form.item_name} onChange={(event) => setFormValue(setForm, "item_name", event.target.value)} />
          </label>
          <Kpi label="Current price" value={money(builtInputs.current_price)} />
          <Kpi label="Target price" value={money(baseline.recommendedPrice)} />
          <Kpi label="M2 adjusted" value={money(currentM2Signal.suggestedPrice)} />
        </section>

        <div className="pricing-workspace">
          <section className="pricing-left">
            {activeTab === "setup" && (
              <>
                <WorkspaceIntro
                  title="Price Item"
                  copy="Build the cost picture for one item. Ingredients, labor, packaging, overhead, and margin all feed the live recommendation."
                />

                <div className="pricing-panel">
                  <div className="panel-head">
                    <div>
                      <h2>Ingredients</h2>
                      <p>Per serving recipe cost, waste, and unit conversion.</p>
                    </div>
                    <div className="inline-actions">
                      <button type="button" onClick={() => setIngredients((current) => [...current, { ...EMPTY_INGREDIENT }])}>Add Ingredient</button>
                      <button type="button" onClick={() => setIngredients([])}>Clear</button>
                    </div>
                  </div>

                  <div className="data-grid ingredient-grid-header">
                    <span>Ingredient</span>
                    <span>Purchase $</span>
                    <span>Buy Qty</span>
                    <span>Buy Unit</span>
                    <span>Used</span>
                    <span>Use Unit</span>
                    <span>Waste</span>
                    <span></span>
                  </div>
                  <div className="ingredient-editor">
                    {ingredients.map((ingredient, index) => (
                      <div className="ingredient-line" key={`${ingredient.name}-${index}`}>
                        <input placeholder="Ingredient" value={ingredient.name} onChange={(event) => updateIngredient(index, { name: event.target.value })} />
                        <input placeholder="0.00" inputMode="decimal" value={ingredient.purchase_price} onChange={(event) => updateIngredient(index, { purchase_price: event.target.value })} />
                        <input placeholder="0" inputMode="decimal" value={ingredient.purchase_qty} onChange={(event) => updateIngredient(index, { purchase_qty: event.target.value })} />
                        <select value={ingredient.purchase_unit} onChange={(event) => updateIngredient(index, { purchase_unit: event.target.value })}>
                          {UNITS.map((unit) => <option key={unit}>{unit}</option>)}
                        </select>
                        <input placeholder="0" inputMode="decimal" value={ingredient.recipe_qty_used} onChange={(event) => updateIngredient(index, { recipe_qty_used: event.target.value })} />
                        <select value={ingredient.recipe_unit} onChange={(event) => updateIngredient(index, { recipe_unit: event.target.value })}>
                          {UNITS.map((unit) => <option key={unit}>{unit}</option>)}
                        </select>
                        <input placeholder="0.05" inputMode="decimal" value={ingredient.waste_pct} onChange={(event) => updateIngredient(index, { waste_pct: event.target.value })} />
                        <button type="button" className="icon-action" onClick={() => setIngredients((current) => current.filter((_, i) => i !== index))}>x</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pricing-panel two-col">
                  <Field label="Global waste %" value={form.default_waste_pct} onChange={(value) => setFormValue(setForm, "default_waste_pct", value)} />
                  <Field
                    label="Base labor $/hr"
                    value={form.labor_hourly_rate}
                    onChange={(value) => setFormValue(setForm, "labor_hourly_rate", value)}
                    disabled={weightedLabor.rate !== null}
                    hint={weightedLabor.rate !== null ? "Synced from weighted labor tiers" : ""}
                  />
                  <Field
                    label="Monthly overhead"
                    value={form.monthly_overhead}
                    onChange={(value) => setFormValue(setForm, "monthly_overhead", value)}
                    disabled={overheadTotal > 0}
                    hint={overheadTotal > 0 ? "Synced from itemized overhead" : ""}
                  />
                  <Field label="Monthly units sold" value={form.monthly_units_sold} onChange={(value) => setFormValue(setForm, "monthly_units_sold", value)} />
                  <Field label="Target margin" value={form.target_margin} onChange={(value) => setFormValue(setForm, "target_margin", value)} />
                  <Field label="Current menu price" value={form.current_price} onChange={(value) => setFormValue(setForm, "current_price", value)} />

                  <div className="pricing-field wide">
                    <label>Labor time</label>
                    <div className="segmented">
                      <button type="button" className={form.labor_mode === "batch" ? "active" : ""} onClick={() => setFormValue(setForm, "labor_mode", "batch")}>Batch</button>
                      <button type="button" className={form.labor_mode === "manual" ? "active" : ""} onClick={() => setFormValue(setForm, "labor_mode", "manual")}>Manual</button>
                    </div>
                    {form.labor_mode === "batch" ? (
                      <div className="mini-row">
                        <input value={form.prep_time_hours} onChange={(event) => setFormValue(setForm, "prep_time_hours", event.target.value)} aria-label="Prep hours" />
                        <input value={form.prep_time_minutes} onChange={(event) => setFormValue(setForm, "prep_time_minutes", event.target.value)} aria-label="Prep minutes" />
                        <input value={form.batch_yield} onChange={(event) => setFormValue(setForm, "batch_yield", event.target.value)} aria-label="Batch yield" />
                        <strong>{batchMinutes(form.prep_time_hours, form.prep_time_minutes, form.batch_yield).toFixed(1)} min/item</strong>
                      </div>
                    ) : (
                      <input value={form.labor_minutes_per_item} onChange={(event) => setFormValue(setForm, "labor_minutes_per_item", event.target.value)} />
                    )}
                  </div>

                  <EditableRows
                    className="wide"
                    title="Packaging"
                    rows={packaging}
                    setRows={setPackaging}
                    columns={[
                      ["name", "Name"],
                      ["pack_price", "Pack $"],
                      ["pack_qty", "Units"],
                      ["used_per_item", "Used"],
                    ]}
                  />
                </div>
              </>
            )}

            {activeTab === "advanced" && (
              <div className="pricing-panel stack">
                <WorkspaceIntro title="Cost Structure" copy="Save reusable restaurant cost assumptions and apply them across menu items." compact />
                <div className="metric-strip">
                  <span>Weighted labor: <strong>{weightedLabor.rate ? money(weightedLabor.rate) + "/hr" : "-"}</strong></span>
                  <span>Total hours: <strong>{weightedLabor.hours.toFixed(1)}</strong></span>
                  <span>Monthly overhead: <strong>{money(overheadTotal)}</strong></span>
                  <span>Cost profile: <strong>{activeCostConfigName || NO_ACTIVE_COST_PROFILE}</strong></span>
                  <span>App fee: <strong>{(blendedAppFee * 100).toFixed(2)}%</strong></span>
                  <span>Card fee: <strong>{(blendedCcFee * 100).toFixed(2)}%</strong></span>
                </div>
                {!activeCostConfigName && (
                  <div className="upgrade-note">
                    Name a cost profile first, then labor, overhead, packaging, fees, and basic assumptions will autosave into that profile.
                  </div>
                )}
                <EditableRows
                  title="Labor tiers"
                  rows={laborTiers}
                  setRows={setLaborTiers}
                  columns={[["role", "Role"], ["wage", "Wage"], ["hours_per_week", "Hours/wk"]]}
                  newRow={{ role: "", wage: "", hours_per_week: "" }}
                  headerAction={
                    <button type="button" onClick={importLaborTiersFromShiftPlanner} disabled={shiftPlannerAccess.loading}>
                      {shiftPlannerAccess.loading ? "Checking Shift Planner..." : "Import from Shift Planner"}
                    </button>
                  }
                />
                <EditableRows title="Overhead items" rows={overheadItems} setRows={setOverheadItems} columns={[["name", "Expense"], ["monthly_cost", "Monthly $"]]} newRow={{ name: "", monthly_cost: "" }} />
                {isPro ? (
                  <>
                    <EditableRows title="Delivery app fees" rows={appFees} setRows={setAppFees} columns={[["name", "Platform"], ["pct", "%"]]} newRow={{ name: "", pct: "" }} />
                    <EditableRows title="Card fees" rows={ccFees} setRows={setCcFees} columns={[["name", "Card type"], ["pct", "%"]]} newRow={{ name: "", pct: "" }} />
                  </>
                ) : (
                  <div className="upgrade-note">Pro unlocks delivery app fee modeling, premium competitor positioning, and deeper scenario planning.</div>
                )}
                <div className="inline-actions">
                  <button type="button" onClick={saveCostConfig}>{activeCostConfigName ? "Save Cost Profile" : "Create Cost Profile"}</button>
                  <button type="button" onClick={() => setOverheadItems(DEFAULT_OVERHEAD)}>Reset Overhead Defaults</button>
                </div>
                <div className={shiftPlannerAccess.active ? "integration-note active" : "integration-note"}>
                  {shiftPlannerAccess.loading
                    ? "Checking whether this account owns Shift Planner."
                    : shiftPlannerAccess.active
                      ? "Shift Planner connected. Import will use roles, wages, and scheduled/max hours from your latest saved schedule."
                      : "Shift Planner is not active on this account, so labor tier import is locked."}
                </div>
                {savedCostConfigs.length > 0 && (
                  <div className="saved-list">
                    {savedCostConfigs.map((config) => (
                      <div className="saved-pill" key={config.id || config.db_id}>
                        <button type="button" className={(config.db_id || config.id) === activeCostConfigId ? "active" : ""} onClick={() => recallCostConfig(config)}>
                          {config.name}
                        </button>
                        <button
                          type="button"
                          className="danger-lite"
                          onClick={() => setModal({ type: "confirm-delete", title: "Delete Cost Profile", target: config, targetKind: "cost" })}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "market" && (
              <>
                <WorkspaceIntro
                  title="Market Guidance"
                  copy="Compare your price against nearby competitors and use the M2 monetary backdrop as a long-range pricing review signal."
                />
                <div className="pricing-panel two-col">
                  <div className="pricing-field wide">
                    <label>Competitor prices</label>
                    <div className="mini-row">
                      {form.competitor_prices.map((price, index) => (
                        <input
                          key={index}
                          value={price}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              competitor_prices: current.competitor_prices.map((item, i) => (i === index ? event.target.value : item)),
                            }))
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <label className="toggle-line">
                    <input type="checkbox" checked={form.auto_min_viable} onChange={(event) => setFormValue(setForm, "auto_min_viable", event.target.checked)} />
                    <span>Protect minimum viable margin</span>
                  </label>
                  <Field label="Minimum viable margin" value={form.min_viable_margin} onChange={(value) => setFormValue(setForm, "min_viable_margin", value)} />
                  <label className="toggle-line">
                    <input type="checkbox" checked={form.premium_positioning} onChange={(event) => setFormValue(setForm, "premium_positioning", event.target.checked)} />
                    <span>Premium positioning</span>
                  </label>
                  <Field label="Premium cap over competitor max" value={form.premium_cap_over_comp_max_pct} onChange={(value) => setFormValue(setForm, "premium_cap_over_comp_max_pct", value)} />
                </div>
                <M2Recommendation signal={currentM2Signal} recommendedPrice={baseline.recommendedPrice} />
              </>
            )}

            {activeTab === "scenario" && (
              <>
                <WorkspaceIntro title="What-if Scenario" copy="Stress-test one change or a whole cost environment before committing to a price." />
                <div className="pricing-panel two-col">
                  <Field label="All ingredients % change" value={scenario.global_ingredient_price_pct} onChange={(value) => setScenarioValue(setScenario, "global_ingredient_price_pct", value)} />
                  <Field label="Specific ingredient" value={scenario.specific_ingredient_name} onChange={(value) => setScenarioValue(setScenario, "specific_ingredient_name", value)} />
                  <Field label="Specific ingredient % change" value={scenario.specific_ingredient_price_pct} onChange={(value) => setScenarioValue(setScenario, "specific_ingredient_price_pct", value)} />
                  <Field label="Labor change $/hr" value={scenario.labor_delta_per_hour} onChange={(value) => setScenarioValue(setScenario, "labor_delta_per_hour", value)} />
                  <Field label="Overhead % change" value={scenario.overhead_pct} onChange={(value) => setScenarioValue(setScenario, "overhead_pct", value)} />
                  <Field label="Volume % change" value={scenario.volume_pct} onChange={(value) => setScenarioValue(setScenario, "volume_pct", value)} />
                </div>
              </>
            )}

            {activeTab === "templates" && (
              <>
                <WorkspaceIntro title="Template Library" copy="Search the cuisine library, start from a known item, then replace generic prices with your supplier costs." />
                <div className="pricing-panel">
                  <input
                    className="template-search"
                    value={templateSearch}
                    onChange={(event) => setTemplateSearch(event.target.value)}
                    placeholder="Search cuisine, category, or item..."
                  />
                  <div className="template-grid">
                    {templateItems.map((item) => (
                      <article key={`${item.cuisineId}-${item.item_name}`}>
                        <span>{item.cuisineName} · {item.category}</span>
                        <h3>{item.item_name}</h3>
                        <p>{item.ingredients.length} ingredients · {item.labor_minutes} min labor · suggested {money(item.suggested_price)}</p>
                        <button type="button" onClick={() => useTemplate(item)}>Use Template</button>
                      </article>
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === "menus" && (
              <>
                <WorkspaceIntro title="Menus" copy="Turn individual item calculations into a saved menu, then export the full pricing table." />
                <div className="pricing-panel stack">
                  <div className="inline-actions">
                    <button type="button" onClick={createMenu}>Create Menu</button>
                    <button type="button" onClick={loadSavedData}>Refresh</button>
                  </div>
                  {menus.length === 0 && <p className="muted-copy">No saved menus yet. Add your current item to create one quickly.</p>}
                  {menus.map((menu) => (
                    <MenuPanel
                      key={menu.id || menu.db_id}
                      menu={menu}
                      onLoad={loadMenuItem}
                      onExport={exportCsv}
                      onDelete={(target) => setModal({ type: "confirm-delete", title: "Delete Menu", target, targetKind: "menu" })}
                      onDeleteItem={(targetMenu, targetIndex) =>
                        setModal({
                          type: "confirm-delete",
                          title: "Delete Menu Item",
                          target: { menu: targetMenu, itemIndex: targetIndex, item: targetMenu.items?.[targetIndex] },
                          targetKind: "menu-item",
                        })
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          <aside className="pricing-right">
            <ResultsPanel title="Live Recommendation" inputs={builtInputs} result={baseline} packagingCost={packagingCost} />
            <M2Recommendation signal={currentM2Signal} recommendedPrice={baseline.recommendedPrice} compact />
            {activeTab === "scenario" && <ResultsPanel title="What-if Results" inputs={whatIfInputs} result={whatIf} packagingCost={packagingCost} />}
          </aside>
        </div>
      </main>

      {modal && (
        <PricingModal
          modal={modal}
          setModal={setModal}
          onSaveCost={saveNamedCostConfig}
          onCreateMenu={createNamedMenu}
          onAddToMenu={addCurrentItemToMenu}
          onResetBlankItem={() => {
            resetNewItem();
            continueNewItemToCosts();
          }}
          onOpenTemplates={openTemplateStep}
          templateItems={modalTemplateItems}
          onUseTemplate={(item) => useTemplate(item, { continueToCosts: true })}
          costConfigs={savedCostConfigs}
          menus={menus}
          onSelectCost={selectNewItemCostConfig}
          onSkipCosts={skipNewItemCosts}
          onDeleteMenu={deleteMenu}
          onDeleteMenuItem={deleteMenuItem}
          onDeleteCost={deleteCostConfig}
        />
      )}
    </div>
  );
}

function PricingModal({
  modal,
  setModal,
  onSaveCost,
  onCreateMenu,
  onAddToMenu,
  onResetBlankItem,
  onOpenTemplates,
  templateItems,
  onUseTemplate,
  costConfigs,
  menus,
  onSelectCost,
  onSkipCosts,
  onDeleteMenu,
  onDeleteMenuItem,
  onDeleteCost,
}) {
  const isNameModal = modal.type === "cost-name" || modal.type === "menu-name";
  const [value, setValue] = useState(modal.value || "");

  useEffect(() => {
    setValue(modal.value || "");
  }, [modal.value, modal.type]);

  function submitName(event) {
    event.preventDefault();
    if (modal.type === "cost-name") onSaveCost(value);
    if (modal.type === "menu-name") onCreateMenu(value, { addCurrentItem: modal.addCurrentItem });
  }

  return (
    <div className="pricing-modal-backdrop" role="dialog" aria-modal="true">
      <div className={`pricing-modal ${modal.type === "template-picker" ? "wide" : ""}`}>
        <div className="pricing-modal-head">
          <div>
            <span>Pricing Assistant</span>
            <h2>{modal.title}</h2>
          </div>
          <button type="button" className="icon-action" onClick={() => setModal(null)} aria-label="Close">x</button>
        </div>

        {isNameModal && (
          <form className="pricing-modal-body" onSubmit={submitName}>
            <label className="pricing-field">
              <span>{modal.type === "cost-name" ? "Cost profile name" : "Menu name"}</span>
              <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} />
            </label>
            <div className="pricing-modal-actions">
              <button type="button" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        )}

        {modal.type === "new-item-template" && (
          <div className="pricing-modal-body">
            <p className="muted-copy">Start from the recipe library or begin with a blank item.</p>
            <div className="modal-choice-grid">
              <button type="button" onClick={onOpenTemplates}>
                <strong>Use Template</strong>
                <span>Choose from the built-in recipe templates.</span>
              </button>
              <button type="button" onClick={onResetBlankItem}>
                <strong>Blank Item</strong>
                <span>Start clean, then choose saved costs.</span>
              </button>
            </div>
          </div>
        )}

        {modal.type === "template-picker" && (
          <div className="pricing-modal-body">
            <input
              className="template-search"
              autoFocus
              value={modal.search || ""}
              onChange={(event) => setModal((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search cuisine, category, or item..."
            />
            <div className="template-grid modal-template-grid">
              {templateItems.map((item) => (
                <article key={`${item.cuisineId}-${item.item_name}`}>
                  <span>{item.cuisineName} · {item.category}</span>
                  <h3>{item.item_name}</h3>
                  <p>{item.ingredients.length} ingredients · {item.labor_minutes} min labor · suggested {money(item.suggested_price)}</p>
                  <button type="button" onClick={() => onUseTemplate(item)}>Use Template</button>
                </article>
              ))}
            </div>
          </div>
        )}

        {modal.type === "new-item-costs" && (
          <div className="pricing-modal-body">
            <p className="muted-copy">Apply a saved cost profile with basic assumptions, labor tiers, overhead, packaging, delivery fees, and card fees.</p>
            {costConfigs.length > 0 ? (
              <div className="modal-list">
                {costConfigs.map((config) => (
                  <button key={config.db_id || config.id} type="button" onClick={() => onSelectCost(config)}>
                    <strong>{config.name}</strong>
                    <span>{(config.overhead_items || []).length} overhead rows · {(config.labor_tiers || []).length} labor tiers</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="upgrade-note">No saved cost profiles yet. Create one in Cost Structure after this item opens.</div>
            )}
            <div className="pricing-modal-actions">
              <button type="button" onClick={() => setModal({ type: "cost-name", title: "Name Cost Profile", value: "Restaurant Costs" })}>Create Profile</button>
              <button type="button" onClick={onSkipCosts}>Skip</button>
            </div>
          </div>
        )}

        {modal.type === "add-to-menu" && (
          <div className="pricing-modal-body">
            <p className="muted-copy">Choose where this priced item should be saved, or create a new menu for it.</p>
            {menus.length > 0 ? (
              <div className="modal-list">
                {menus.map((menu) => (
                  <button key={menu.db_id || menu.id} type="button" onClick={() => onAddToMenu(menu)}>
                    <strong>{menu.menu_name}</strong>
                    <span>{(menu.items || []).length} saved item{(menu.items || []).length === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="upgrade-note">No menus saved yet. Create one and this item will be added to it.</div>
            )}
            <div className="pricing-modal-actions">
              <button type="button" onClick={() => setModal({ type: "menu-name", title: "Create Menu", value: "My Menu", addCurrentItem: true })}>
                Create New Menu
              </button>
              <button type="button" onClick={() => setModal(null)}>Cancel</button>
            </div>
          </div>
        )}

        {modal.type === "confirm-delete" && (
          <div className="pricing-modal-body">
            <p className="muted-copy">
              Delete {deleteTargetLabel(modal)}? This cannot be undone.
            </p>
            <div className="pricing-modal-actions">
              <button type="button" onClick={() => setModal(null)}>Cancel</button>
              <button
                type="button"
                className="danger-lite"
                onClick={() => {
                  if (modal.targetKind === "menu") onDeleteMenu(modal.target);
                  if (modal.targetKind === "cost") onDeleteCost(modal.target);
                  if (modal.targetKind === "menu-item") onDeleteMenuItem(modal.target.menu, modal.target.itemIndex);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultsPanel({ title, inputs, result, packagingCost }) {
  const competitive = result.competitiveProfitablePrice || result.recommendedPrice;
  const overheadWithoutPackaging = Math.max(0, result.overheadCost - packagingCost);
  return (
    <section className="results-panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className={`status-chip ${String(result.status || "neutral").toLowerCase().replace(" ", "-")}`}>
          {result.status || "Live"}
        </span>
      </div>
      <div className="callout-price">{money(result.recommendedPrice)}</div>
      <div className="kpi-grid">
        <Kpi label="Competitive" value={money(competitive)} />
        <Kpi label="Break-even" value={money(result.breakEvenPrice)} />
        <Kpi label="True cost" value={money(result.trueCost)} />
        <Kpi label="Profit @ current" value={money(result.profitAtCurrent)} />
      </div>
      <div className="breakdown-grid">
        <Breakdown title="Costs" rows={[
          ["Food", money(result.foodCost)],
          ["Waste", money(result.wasteCost)],
          ["Labor", money(result.laborCost)],
          ["Packaging", money(packagingCost)],
          ["Overhead", money(overheadWithoutPackaging)],
          ["True Cost", money(result.trueCost)],
        ]} />
        <Breakdown title="Pricing" rows={[
          ["Target margin", pct(inputs.target_margin * 100)],
          ["CC fee", pct(inputs.cc_fee_pct * 100)],
          ["App fee", inputs.app_fee_pct ? pct(inputs.app_fee_pct * 100) : "-"],
          ["Current", money(inputs.current_price)],
          ["Margin", pct(result.marginAtCurrent)],
          ["Status", result.status || "-"],
        ]} />
        <Breakdown title="Competitors" rows={[
          ["Min", money(result.competitorMin)],
          ["Avg", money(result.competitorAvg)],
          ["Max", money(result.competitorMax)],
          ["Max margin @ avg", pct(result.maxMarginIfMatchCompAvg)],
        ]} />
      </div>
      {result.errors.length > 0 && <div className="pricing-error">{result.errors.join(" · ")}</div>}
      <div className="ingredient-breakdown">
        {result.ingredientRows.map((row, index) => (
          <div key={`${row.name}-${index}`}>
            <span>{row.name}</span>
            <strong>{money(row.total)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkspaceIntro({ title, copy, compact = false }) {
  return (
    <div className={`workspace-intro ${compact ? "compact" : ""}`}>
      <div>
        <span>Workspace</span>
        <h2>{title}</h2>
      </div>
      <p>{copy}</p>
    </div>
  );
}

function M2Recommendation({ signal, recommendedPrice, compact = false }) {
  return (
    <section className={`m2-card ${compact ? "compact" : ""}`}>
      <div className="panel-head">
        <div>
          <h2>Monetary Backdrop</h2>
          <p>M2 money supply, read as a long-range pricing pressure signal.</p>
        </div>
        <span className="status-chip">{signal.loading ? "Loading" : signal.label}</span>
      </div>
      <div className="m2-grid">
        <Kpi label="M2 YoY" value={signal.available ? pct(signal.yoyChange) : "-"} />
        <Kpi label="Review cushion" value={signal.available ? pct(signal.suggestedLift) : "-"} />
        <Kpi label="Base target" value={money(recommendedPrice)} />
        <Kpi label="M2 adjusted" value={money(signal.suggestedPrice)} />
      </div>
      <p className="m2-summary">{signal.summary}</p>
      <div className="m2-action">
        <strong>{signal.action}</strong>
        {signal.latestDate && <span>Latest M2 observation: {signal.latestDate}</span>}
      </div>
    </section>
  );
}

function Kpi({ label, value }) {
  return <div className="kpi"><span>{label}</span><strong>{value}</strong></div>;
}

function deleteTargetLabel(modal) {
  if (modal.targetKind === "menu") return modal.target?.menu_name || "this menu";
  if (modal.targetKind === "cost") return modal.target?.name || "this cost profile";
  if (modal.targetKind === "menu-item") return modal.target?.item?.item_name || "this menu item";
  return "this item";
}

function Breakdown({ title, rows }) {
  return (
    <div className="breakdown">
      <h3>{title}</h3>
      {rows.map(([label, value]) => (
        <div key={label}><span>{label}</span><strong>{value}</strong></div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, disabled = false, hint = "" }) {
  return (
    <label className="pricing-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

function EditableRows({ title, rows, setRows, columns, newRow, className = "", headerAction = null }) {
  const blank = newRow || Object.fromEntries(columns.map(([key]) => [key, ""]));
  return (
    <div className={`editable-block ${className}`}>
      <div className="panel-head">
        <h3>{title}</h3>
        <div className="inline-actions compact-actions">
          {headerAction}
          <button type="button" onClick={() => setRows((current) => [...current, { ...blank }])}>Add</button>
        </div>
      </div>
      <div className="editable-rows">
        {rows.map((row, index) => (
          <div className="editable-row" key={index}>
            {columns.map(([key, placeholder]) => (
              <input
                key={key}
                placeholder={placeholder}
                value={row[key] ?? ""}
                onChange={(event) =>
                  setRows((current) => current.map((item, i) => (i === index ? { ...item, [key]: event.target.value } : item)))
                }
              />
            ))}
            <button type="button" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MenuPanel({ menu, onLoad, onExport, onDelete, onDeleteItem }) {
  const totals = (menu.items || []).map((item) => calculatePricing(normalizeSavedItem(item)));
  const avgCost = totals.length ? totals.reduce((sum, result) => sum + result.trueCost, 0) / totals.length : 0;
  const avgRecommended = totals.length ? totals.reduce((sum, result) => sum + result.recommendedPrice, 0) / totals.length : 0;
  return (
    <article className="menu-panel">
      <div className="panel-head">
        <div>
          <h3>{menu.menu_name}</h3>
          <p>{(menu.items || []).length} items · avg cost {money(avgCost)} · avg recommended {money(avgRecommended)}</p>
        </div>
        <div className="inline-actions">
          <button type="button" onClick={() => onExport(menu)}>Export CSV</button>
          <button type="button" className="danger-lite" onClick={() => onDelete(menu)}>Delete</button>
        </div>
      </div>
      <div className="menu-items">
        {(menu.items || []).map((item, index) => {
          const result = calculatePricing(normalizeSavedItem(item));
          return (
            <div className="menu-item-row" key={`${item.item_name}-${index}`}>
              <button type="button" onClick={() => onLoad(menu, index)}>
                <span>{item.item_name}</span>
                <strong>{money(result.recommendedPrice)}</strong>
              </button>
              <button type="button" className="danger-lite" onClick={() => onDeleteItem(menu, index)}>Delete</button>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function batchMinutes(hours, minutes, batchYield) {
  const total = Math.max(0, num(hours) * 60 + num(minutes));
  const yielded = Math.max(0, num(batchYield));
  return total > 0 && yielded > 0 ? total / yielded : 0;
}

function shiftHoursForImport(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 1440;
  return mins / 60;
}

function blendedFee(rows) {
  const values = rows.map((row) => num(row.pct)).filter((value) => value > 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length / 100 : 0;
}

function setFormValue(setForm, key, value) {
  setForm((current) => ({ ...current, [key]: value }));
}

function setScenarioValue(setScenario, key, value) {
  setScenario((current) => ({ ...current, [key]: value }));
}

function draftStorageKey(userId) {
  return `pricing-assistant-draft:${userId || "anonymous"}`;
}

function formatNumberForInput(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function pickCostForm(form) {
  return {
    labor_hourly_rate: form.labor_hourly_rate,
    labor_minutes_per_item: form.labor_minutes_per_item,
    prep_time_hours: form.prep_time_hours,
    prep_time_minutes: form.prep_time_minutes,
    batch_yield: form.batch_yield,
    labor_mode: form.labor_mode,
    monthly_overhead: form.monthly_overhead,
    monthly_units_sold: form.monthly_units_sold,
    target_margin: form.target_margin,
    default_waste_pct: form.default_waste_pct,
    auto_min_viable: form.auto_min_viable,
    min_viable_margin: form.min_viable_margin,
    premium_positioning: form.premium_positioning,
    premium_cap_over_comp_max_pct: form.premium_cap_over_comp_max_pct,
  };
}

function slugId(value) {
  return String(value || "cost-profile")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "cost-profile";
}

function buildCostConfig(name, data) {
  return {
    id: data.id || crypto.randomUUID(),
    name,
    created_at: data.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    labor_tiers: data.laborTiers,
    overhead_items: data.overheadItems,
    packaging: data.packaging,
    app_fees: data.appFees,
    cc_fees: data.ccFees,
    cost_form: pickCostForm(data.form),
  };
}

function upsertById(list, item) {
  const key = item.db_id || item.id;
  const exists = list.some((entry) => (entry.db_id || entry.id) === key);
  return exists ? list.map((entry) => ((entry.db_id || entry.id) === key ? item : entry)) : [item, ...list];
}

function serializeCurrentItem(inputs, ui) {
  return {
    ...inputs,
    ui,
    ingredients: ui.form ? ui.form.ingredients || inputs.ingredients : inputs.ingredients,
  };
}

function deserializeForm(item) {
  return {
    item_name: item.item_name,
    default_waste_pct: String(item.default_waste_pct ?? "0.05"),
    labor_hourly_rate: String(item.labor_hourly_rate ?? "18"),
    labor_minutes_per_item: String(item.labor_minutes_per_item ?? "4"),
    monthly_overhead: String(item.monthly_overhead ?? "0"),
    monthly_units_sold: String(item.monthly_units_sold ?? "0"),
    target_margin: String(item.target_margin ?? "0.20"),
    current_price: item.current_price ? String(item.current_price) : "",
    competitor_prices: [0, 1, 2].map((index) => String(item.competitor_prices?.[index] ?? "")),
  };
}

function normalizeSavedItem(item) {
  return {
    ...item,
    ingredients: item.ingredients || [],
    labor_hourly_rate: num(item.labor_hourly_rate),
    labor_minutes_per_item: num(item.labor_minutes_per_item),
    monthly_overhead: num(item.monthly_overhead),
    monthly_units_sold: num(item.monthly_units_sold),
    target_margin: num(item.target_margin, 0.2),
    current_price: item.current_price ? num(item.current_price) : null,
    default_waste_pct: num(item.default_waste_pct),
    competitor_prices: (item.competitor_prices || []).map((price) => num(price)).filter((price) => price > 0),
    auto_min_viable: item.auto_min_viable ?? true,
    min_viable_margin: num(item.min_viable_margin, 0.1),
    premium_positioning: item.premium_positioning ?? false,
    premium_cap_over_comp_max_pct: num(item.premium_cap_over_comp_max_pct, 0.1),
    cc_fee_pct: num(item.cc_fee_pct),
    app_fee_pct: num(item.app_fee_pct),
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
