"use strict";

// ─────────────────────────────────────────────
// Konstanta model (sama dengan transjakarta_enrichment.ipynb)
// ─────────────────────────────────────────────
const PERIODS = [
  { key: "Morning Peak", label: "Morning Peak", color: "--series-1" },
  { key: "Evening Peak", label: "Evening Peak", color: "--series-2" },
  { key: "Midday", label: "Midday", color: "--series-3" },
  { key: "Off-Peak", label: "Off-Peak", color: "--neutral-1" },
  { key: "Off-Peak Night", label: "Off-Peak Night", color: "--neutral-2" },
];
const MULTIPLIER = {
  "Morning Peak": 1.3,
  "Evening Peak": 1.3,
  "Midday": 1.1,
  "Off-Peak": 0.8,
  "Off-Peak Night": 0.5,
};
const DEFAULT_ASSUMPTIONS = { cap: 60, headway: 10, eff: 80, overload: 3 };
const DOW = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]; // Senin = 0
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function classifyPeak(hour) {
  if (hour >= 6 && hour <= 9) return "Morning Peak";
  if (hour >= 16 && hour <= 19) return "Evening Peak";
  if (hour >= 11 && hour <= 13) return "Midday";
  if (hour >= 22 || hour <= 5) return "Off-Peak Night";
  return "Off-Peak";
}
const HOUR_PERIOD = Array.from({ length: 24 }, (_, h) => classifyPeak(h));

function busDemand(passengers, period, a) {
  const capacityPerHour = (60 / a.headway) * a.cap * (a.eff / 100);
  const raw = Math.ceil(passengers / capacityPerHour);
  return Math.max(1, Math.ceil(raw * (MULTIPLIER[period] ?? 1)));
}

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
const state = {
  data: null,
  dayDow: [],       // index hari -> 0..6 (Senin = 0)
  dayLabel: [],
  filters: { start: 0, end: 0, daytype: "all", corridor: "all", periods: new Set(PERIODS.map((p) => p.key)) },
  assumptions: { ...DEFAULT_ASSUMPTIONS },
  sort: { key: "total", dir: "desc" },
  search: "",
  charts: {},
  map: null,
  mapLayer: null,
  tileLayer: null,
  lastAgg: null,
};

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("id-ID");
const fmt1 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
async function init() {
  document.body.classList.add("loading");
  const res = await fetch("data/trips.json");
  state.data = await res.json();

  const [y, m, d] = state.data.meta.start_date.split("-").map(Number);
  for (let i = 0; i < state.data.meta.days; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    state.dayDow.push((date.getUTCDay() + 6) % 7);
    state.dayLabel.push(`${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`);
  }
  state.filters.end = state.data.meta.days - 1;

  const first = new Date(Date.UTC(y, m - 1, d));
  $("period-label").textContent = `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`
    .replace("Apr", "April");

  setupFilters();
  setupAssumptions();
  setupTable();
  setupTheme();
  setupMap();

  $("data-note").textContent =
    `Sumber: ${state.data.meta.source} · ${fmt.format(state.data.meta.rows_used)} dari ` +
    `${fmt.format(state.data.meta.rows_raw)} baris dipakai (baris tanpa koridor/halte/waktu valid dibuang).`;

  render();
  document.body.classList.remove("loading");
}

function isoDay(index) {
  const [y, m, d] = state.data.meta.start_date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + index)).toISOString().slice(0, 10);
}
function dayFromIso(iso) {
  const [y, m, d] = state.data.meta.start_date.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  const [yy, mm, dd] = iso.split("-").map(Number);
  return Math.round((Date.UTC(yy, mm - 1, dd) - start) / 86400000);
}

function setupFilters() {
  const f = state.filters;
  const startInput = $("f-start");
  const endInput = $("f-end");
  for (const input of [startInput, endInput]) {
    input.min = isoDay(0);
    input.max = isoDay(state.data.meta.days - 1);
  }
  startInput.value = isoDay(f.start);
  endInput.value = isoDay(f.end);

  const clampDay = (v, fallback) => {
    if (!v) return fallback;
    return Math.min(state.data.meta.days - 1, Math.max(0, dayFromIso(v)));
  };
  startInput.addEventListener("change", () => {
    f.start = clampDay(startInput.value, 0);
    if (f.start > f.end) { f.end = f.start; endInput.value = isoDay(f.end); }
    render();
  });
  endInput.addEventListener("change", () => {
    f.end = clampDay(endInput.value, state.data.meta.days - 1);
    if (f.end < f.start) { f.start = f.end; startInput.value = isoDay(f.start); }
    render();
  });

  $("f-daytype").addEventListener("change", (e) => { f.daytype = e.target.value; render(); });

  const corridorSelect = $("f-corridor");
  const corridors = state.data.corridors
    .map(([id, name], i) => ({ id, name, i }))
    .sort((a, b) => a.id.localeCompare(b.id, "id", { numeric: true }));
  for (const c of corridors) {
    corridorSelect.appendChild(el("option", { value: String(c.i) }, `${c.id} · ${c.name}`));
  }
  corridorSelect.addEventListener("change", (e) => { f.corridor = e.target.value; render(); });

  const fieldset = $("f-periods");
  const row = el("div", { class: "chip-row" });
  for (const p of PERIODS) {
    const btn = el("button", { type: "button", class: "chip", "aria-pressed": "true", "data-key": p.key });
    btn.appendChild(el("span", { class: "dot", style: `background: var(${p.color})` }));
    btn.appendChild(document.createTextNode(p.label));
    btn.addEventListener("click", () => {
      if (f.periods.has(p.key)) {
        if (f.periods.size === 1) return; // minimal satu periode aktif
        f.periods.delete(p.key);
      } else {
        f.periods.add(p.key);
      }
      btn.setAttribute("aria-pressed", String(f.periods.has(p.key)));
      render();
    });
    row.appendChild(btn);
  }
  fieldset.appendChild(row);

  $("f-reset").addEventListener("click", () => {
    f.start = 0;
    f.end = state.data.meta.days - 1;
    f.daytype = "all";
    f.corridor = "all";
    f.periods = new Set(PERIODS.map((p) => p.key));
    startInput.value = isoDay(f.start);
    endInput.value = isoDay(f.end);
    $("f-daytype").value = "all";
    corridorSelect.value = "all";
    fieldset.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "true"));
    render();
  });
}

function setupAssumptions() {
  const map = { cap: "a-cap", headway: "a-headway", eff: "a-eff", overload: "a-overload" };
  for (const [key, id] of Object.entries(map)) {
    const input = $(id);
    input.value = state.assumptions[key];
    input.addEventListener("input", () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v <= 0) return;
      state.assumptions[key] = key === "eff" ? Math.min(100, v) : v;
      render();
    });
  }
}

function setupTable() {
  document.querySelectorAll("#fleet-table th").forEach((th) => {
    th.tabIndex = 0;
    const activate = () => {
      const key = th.dataset.key;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else state.sort = { key, dir: key === "id" || key === "name" ? "asc" : "desc" };
      renderTable(state.lastAgg);
    };
    th.addEventListener("click", activate);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });
  });
  $("fleet-search").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderTable(state.lastAgg);
  });
}

function currentTheme() {
  const set = document.documentElement.getAttribute("data-theme");
  if (set) return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setupTheme() {
  $("theme-toggle").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("tj-theme", next); } catch (e) {}
    onThemeChange();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onThemeChange);
}

function onThemeChange() {
  setTiles();
  for (const chart of Object.values(state.charts)) chart.destroy();
  state.charts = {};
  render();
}

// ─────────────────────────────────────────────
// Agregasi
// ─────────────────────────────────────────────
function aggregate() {
  const { trips, stations, corridors } = state.data;
  const f = state.filters;
  const a = state.assumptions;
  const corridorFilter = f.corridor === "all" ? -1 : Number(f.corridor);
  const days = state.data.meta.days;

  const hourly = new Array(24).fill(0);
  const daily = new Array(days).fill(0);
  const dowHour = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const dowDays = new Array(7).fill(0);
  const stationTotals = new Map();
  const slotCounts = new Map();     // halte|koridor|hari|jam -> penumpang (grain fact table)
  const corridorHour = new Map();   // koridor|hari|jam -> penumpang
  let total = 0;

  const includedDay = new Array(days).fill(false);
  for (let d = f.start; d <= f.end; d++) {
    const weekend = state.dayDow[d] >= 5;
    if (f.daytype === "weekday" && weekend) continue;
    if (f.daytype === "weekend" && !weekend) continue;
    includedDay[d] = true;
    dowDays[state.dayDow[d]]++;
  }

  const n = trips.s.length;
  for (let i = 0; i < n; i++) {
    const d = trips.d[i];
    if (!includedDay[d]) continue;
    const c = trips.c[i];
    if (corridorFilter >= 0 && c !== corridorFilter) continue;
    const h = trips.h[i];
    if (!f.periods.has(HOUR_PERIOD[h])) continue;
    const s = trips.s[i];

    total++;
    hourly[h]++;
    daily[d]++;
    dowHour[state.dayDow[d]][h]++;
    stationTotals.set(s, (stationTotals.get(s) || 0) + 1);

    const slotKey = ((s * 256 + c) * 64 + d) * 24 + h;
    slotCounts.set(slotKey, (slotCounts.get(slotKey) || 0) + 1);
    const chKey = (c * 64 + d) * 24 + h;
    corridorHour.set(chKey, (corridorHour.get(chKey) || 0) + 1);
  }

  // Slot overload per koridor & per halte
  const corridorStats = new Map();
  const stationOverload = new Map();
  let overloadSlots = 0;
  for (const [key, count] of slotCounts) {
    const h = key % 24;
    const rest = (key - h) / 24;
    const d = rest % 64;
    const sc = (rest - d) / 64;
    const c = sc % 256;
    const s = (sc - c) / 256;
    const cs = getCorridorStats(corridorStats, c);
    cs.stations.add(s);
    if (count >= a.overload) {
      overloadSlots++;
      cs.overload++;
      stationOverload.set(s, (stationOverload.get(s) || 0) + 1);
    }
  }

  // Beban & demand bus per koridor per jam
  for (const [key, count] of corridorHour) {
    const h = key % 24;
    const c = ((key - h) / 24 - (((key - h) / 24) % 64)) / 64;
    const period = HOUR_PERIOD[h];
    const cs = getCorridorStats(corridorStats, c);
    cs.total += count;
    cs.peakLoad = Math.max(cs.peakLoad, count);
    cs.buses = Math.max(cs.buses, busDemand(count, period, a));
    if (period === "Morning Peak") cs.morningSum += count;
    if (period === "Evening Peak") cs.eveningSum += count;
  }

  const includedDays = includedDay.filter(Boolean).length || 1;
  const rows = [];
  for (const [c, cs] of corridorStats) {
    rows.push({
      id: corridors[c][0],
      name: corridors[c][1],
      total: cs.total,
      peakLoad: cs.peakLoad,
      // rata-rata penumpang per jam di periode tsb (4 jam per peak) per hari yang difilter
      morning: cs.morningSum / (4 * includedDays),
      evening: cs.eveningSum / (4 * includedDays),
      overload: cs.overload,
      buses: cs.buses,
    });
  }

  const peakTrips = hourly.reduce((sum, v, h) =>
    sum + (HOUR_PERIOD[h] === "Morning Peak" || HOUR_PERIOD[h] === "Evening Peak" ? v : 0), 0);
  const busiestHour = hourly.indexOf(Math.max(...hourly));

  return {
    total,
    hourly,
    daily,
    includedDay,
    dowHour,
    dowDays,
    stationTotals,
    stationOverload,
    slots: slotCounts.size,
    overloadSlots,
    rows,
    peakShare: total ? peakTrips / total : 0,
    busiestHour: total ? busiestHour : null,
    fleetTotal: rows.reduce((s, r) => s + r.buses, 0),
    stations,
  };
}

function getCorridorStats(map, c) {
  let cs = map.get(c);
  if (!cs) {
    cs = { total: 0, peakLoad: 0, buses: 0, morningSum: 0, eveningSum: 0, overload: 0, stations: new Set() };
    map.set(c, cs);
  }
  return cs;
}

// ─────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────
function render() {
  const agg = aggregate();
  state.lastAgg = agg;
  renderKpis(agg);
  renderHourly(agg);
  renderDaily(agg);
  renderHeatmap(agg);
  renderStations(agg);
  renderMap(agg);
  renderTable(agg);
  const a = state.assumptions;
  const capHour = (60 / a.headway) * a.cap * (a.eff / 100);
  $("fleet-formula").textContent =
    `Bus = ⌈⌈penumpang/jam ÷ ${fmt.format(Math.round(capHour))}⌉ × multiplier periode⌉, ` +
    `diambil nilai maksimum per koridor (kapasitas ${a.cap}, headway ${a.headway} menit, load factor ${a.eff}%).`;
}

function renderKpis(agg) {
  const box = $("kpis");
  box.replaceChildren();
  const tiles = [
    { label: "Total perjalanan", value: fmt.format(agg.total), note: "tap-in pada filter aktif" },
    { label: "Halte aktif", value: fmt.format(agg.stationTotals.size), note: `${fmt.format(agg.rows.length)} koridor` },
    { label: "Share jam sibuk", value: `${fmt1.format(agg.peakShare * 100)}%`, note: "Morning + Evening Peak" },
    {
      label: "Jam tersibuk",
      value: agg.busiestHour === null ? "–" : `${String(agg.busiestHour).padStart(2, "0")}:00`,
      note: agg.busiestHour === null ? "" : `${fmt.format(agg.hourly[agg.busiestHour])} penumpang`,
    },
    {
      label: "Slot overload",
      value: fmt.format(agg.overloadSlots),
      note: `${fmt1.format(agg.slots ? (agg.overloadSlots / agg.slots) * 100 : 0)}% dari ${fmt.format(agg.slots)} slot halte-jam`,
    },
    { label: "Rekomendasi armada", value: fmt.format(agg.fleetTotal), note: "total bus saat beban puncak" },
  ];
  for (const t of tiles) {
    const card = el("div", { class: "kpi" });
    card.appendChild(el("div", { class: "kpi-label" }, t.label));
    card.appendChild(el("div", { class: "kpi-value" }, t.value));
    card.appendChild(el("div", { class: "kpi-note" }, t.note));
    box.appendChild(card);
  }
}

function baseChartOptions() {
  const muted = cssVar("--text-muted");
  const grid = cssVar("--grid");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssVar("--surface"),
        titleColor: cssVar("--text-secondary"),
        bodyColor: cssVar("--text-primary"),
        borderColor: cssVar("--axis"),
        borderWidth: 1,
        padding: 10,
        bodyFont: { weight: "600", size: 13 },
        titleFont: { weight: "400", size: 12 },
        displayColors: false,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: cssVar("--axis") },
        ticks: { color: muted, font: { size: 11 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: grid },
        border: { display: false },
        ticks: { color: muted, font: { size: 11 }, callback: (v) => fmt.format(v) },
      },
    },
  };
}

function upsertChart(key, canvasId, config) {
  const existing = state.charts[key];
  if (existing) {
    existing.data = config.data;
    existing.update();
    return existing;
  }
  state.charts[key] = new Chart($(canvasId), config);
  return state.charts[key];
}

function renderHourly(agg) {
  const colors = HOUR_PERIOD.map((p) => cssVar(PERIODS.find((x) => x.key === p).color));
  upsertChart("hourly", "chart-hourly", {
    type: "bar",
    data: {
      labels: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")),
      datasets: [{
        data: agg.hourly,
        backgroundColor: colors,
        hoverBackgroundColor: colors,
        borderRadius: { topLeft: 4, topRight: 4 },
        borderSkipped: "bottom",
        categoryPercentage: 0.9,
        barPercentage: 0.92,
      }],
    },
    options: (() => {
      const o = baseChartOptions();
      o.plugins.tooltip.callbacks = {
        title: (items) => `${items[0].label}:00 · ${HOUR_PERIOD[items[0].dataIndex]}`,
        label: (item) => `${fmt.format(item.raw)} penumpang`,
      };
      return o;
    })(),
  });

  const legend = $("legend-hourly");
  legend.replaceChildren();
  for (const p of PERIODS) {
    const item = el("span", { class: "legend-item" });
    item.appendChild(el("span", { class: "legend-swatch", style: `background: var(${p.color})` }));
    item.appendChild(document.createTextNode(p.label));
    legend.appendChild(item);
  }
}

function renderDaily(agg) {
  const labels = [];
  const values = [];
  for (let d = 0; d < agg.daily.length; d++) {
    if (!agg.includedDay[d]) continue;
    labels.push(`${DOW[state.dayDow[d]]}, ${state.dayLabel[d]}`);
    values.push(agg.daily[d]);
  }
  const series = cssVar("--series-1");
  upsertChart("daily", "chart-daily", {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: series,
        backgroundColor: series,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBorderWidth: 2,
        pointHoverBorderColor: cssVar("--surface"),
        tension: 0.25,
      }],
    },
    options: (() => {
      const o = baseChartOptions();
      o.interaction = { mode: "index", intersect: false };
      o.plugins.tooltip.callbacks = { label: (item) => `${fmt.format(item.raw)} perjalanan` };
      o.scales.x.ticks.maxRotation = 0;
      o.scales.x.ticks.autoSkipPadding = 16;
      o.scales.x.ticks.callback = function (v) { return this.getLabelForValue(v).split(", ")[1]; };
      return o;
    })(),
    plugins: [crosshairPlugin],
  });
}

const crosshairPlugin = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.() || [];
    if (!active.length) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = cssVar("--axis");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function renderHeatmap(agg) {
  const box = $("heatmap");
  box.replaceChildren();
  const avg = agg.dowHour.map((row, dow) => row.map((v) => (agg.dowDays[dow] ? v / agg.dowDays[dow] : null)));
  const max = Math.max(0, ...avg.flat().filter((v) => v !== null));
  const steps = 7;
  const tip = $("tooltip");

  box.appendChild(el("span"));
  for (let h = 0; h < 24; h++) {
    box.appendChild(el("span", { class: `col-label${h % 2 ? " odd" : ""}` }, String(h)));
  }
  for (let dow = 0; dow < 7; dow++) {
    box.appendChild(el("span", { class: "row-label" }, DOW[dow]));
    for (let h = 0; h < 24; h++) {
      const v = avg[dow][h];
      const cell = el("span", { class: "heat-cell", tabindex: "-1" });
      if (v !== null && v > 0 && max > 0) {
        const step = Math.max(1, Math.ceil((v / max) * steps));
        cell.style.background = `var(--seq-${step})`;
      }
      const label = v === null
        ? `${DOW[dow]} ${String(h).padStart(2, "0")}:00 · tidak ada hari di filter`
        : `${DOW[dow]} ${String(h).padStart(2, "0")}:00 · ${fmt1.format(v)} penumpang rata-rata`;
      cell.setAttribute("aria-label", label);
      const show = (e) => {
        tip.replaceChildren();
        tip.appendChild(el("strong", {}, v === null ? "–" : `${fmt1.format(v)} penumpang/jam`));
        tip.appendChild(el("span", {}, `${DOW[dow]} · ${String(h).padStart(2, "0")}:00 · ${HOUR_PERIOD[h]}`));
        tip.hidden = false;
        positionTip(e.clientX, e.clientY);
      };
      cell.addEventListener("pointermove", show);
      cell.addEventListener("pointerleave", () => { tip.hidden = true; });
      box.appendChild(cell);
    }
  }

  const scale = $("heat-scale");
  scale.replaceChildren();
  scale.appendChild(el("span", {}, "0"));
  const bar = el("span", { class: "scale-bar" });
  for (let i = 1; i <= steps; i++) bar.appendChild(el("span", { style: `background: var(--seq-${i})` }));
  scale.appendChild(bar);
  scale.appendChild(el("span", {}, `${fmt1.format(max)} penumpang/jam`));
}

function positionTip(x, y) {
  const tip = $("tooltip");
  const rect = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - 14;
  if (top + rect.height > window.innerHeight - 8) top = y - rect.height - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

function renderStations(agg) {
  const top = [...agg.stationTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = top.map(([s]) => agg.stations[s][1]);
  upsertChart("stations", "chart-stations", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: top.map(([, v]) => v),
        backgroundColor: cssVar("--series-1"),
        hoverBackgroundColor: cssVar("--seq-5"),
        borderRadius: { topRight: 4, bottomRight: 4 },
        borderSkipped: "left",
        categoryPercentage: 0.9,
        barPercentage: 0.85,
      }],
    },
    options: (() => {
      const o = baseChartOptions();
      o.indexAxis = "y";
      const x = o.scales.x;
      o.scales.x = { ...o.scales.y, beginAtZero: true };
      o.scales.y = { ...x, ticks: { ...x.ticks, color: cssVar("--text-secondary"), font: { size: 12 } } };
      o.plugins.tooltip.callbacks = { label: (item) => `${fmt.format(item.raw)} penumpang` };
      return o;
    })(),
  });
}

// ─────────────────────────────────────────────
// Peta
// ─────────────────────────────────────────────
function setupMap() {
  state.map = L.map("map", { zoomControl: true, scrollWheelZoom: false, preferCanvas: true })
    .setView([-6.21, 106.845], 11);
  setTiles();
  state.mapLayer = L.layerGroup().addTo(state.map);
}

function setTiles() {
  if (!state.map) return;
  if (state.tileLayer) state.map.removeLayer(state.tileLayer);
  const style = currentTheme() === "dark" ? "dark_all" : "light_all";
  state.tileLayer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(state.map);
}

function renderMap(agg) {
  state.mapLayer.clearLayers();
  const entries = [...agg.stationTotals.entries()];
  if (!entries.length) return;
  const max = Math.max(...entries.map(([, v]) => v));
  const fill = cssVar("--series-1");
  const ring = cssVar("--surface");
  entries.sort((a, b) => a[1] - b[1]); // yang besar digambar paling atas
  for (const [s, v] of entries) {
    const [, name, lat, lon] = agg.stations[s];
    const over = agg.stationOverload.get(s) || 0;
    const marker = L.circleMarker([lat, lon], {
      radius: 3 + Math.sqrt(v / max) * 14,
      color: ring,
      weight: 1,
      fillColor: fill,
      fillOpacity: 0.55,
    });
    const tip = document.createElement("div");
    tip.appendChild(el("strong", {}, `${fmt.format(v)} penumpang`));
    tip.appendChild(el("div", {}, name));
    if (over) tip.appendChild(el("div", { class: "flag" }, `${fmt.format(over)} slot overload`));
    marker.bindTooltip(tip, { direction: "top", offset: [0, -4] });
    marker.addTo(state.mapLayer);
  }
  if (state.filters.corridor !== "all") {
    const bounds = L.latLngBounds(entries.map(([s]) => [agg.stations[s][2], agg.stations[s][3]]));
    state.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
  }
}

// ─────────────────────────────────────────────
// Tabel armada
// ─────────────────────────────────────────────
function renderTable(agg) {
  if (!agg) return;
  const { key, dir } = state.sort;
  const q = state.search;
  let rows = agg.rows;
  if (q) rows = rows.filter((r) => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  rows = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const cmp = typeof av === "string" ? av.localeCompare(bv, "id", { numeric: true }) : av - bv;
    return dir === "asc" ? cmp : -cmp;
  });

  document.querySelectorAll("#fleet-table th").forEach((th) => {
    if (th.dataset.key === key) th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  });

  const maxBus = Math.max(1, ...agg.rows.map((r) => r.buses));
  const tbody = document.querySelector("#fleet-table tbody");
  tbody.replaceChildren();
  for (const r of rows) {
    const tr = el("tr");
    tr.appendChild(el("td", { class: "id" }, r.id));
    tr.appendChild(el("td", {}, r.name));
    tr.appendChild(el("td", { class: "num" }, fmt.format(r.total)));
    tr.appendChild(el("td", { class: "num" }, fmt.format(r.peakLoad)));
    tr.appendChild(el("td", { class: "num" }, fmt1.format(r.morning)));
    tr.appendChild(el("td", { class: "num" }, fmt1.format(r.evening)));
    const over = el("td", { class: "num" });
    if (r.overload) over.appendChild(el("span", { class: "flag" }, `▲ ${fmt.format(r.overload)}`));
    else over.textContent = "0";
    tr.appendChild(over);
    const busTd = el("td", { class: "num" });
    const wrap = el("span", { class: "bus-cell" });
    wrap.appendChild(el("span", { class: "bus-bar", style: `width: ${Math.round((r.buses / maxBus) * 48)}px` }));
    wrap.appendChild(el("strong", {}, fmt.format(r.buses)));
    busTd.appendChild(wrap);
    tr.appendChild(busTd);
    tbody.appendChild(tr);
  }
  if (!rows.length) {
    const tr = el("tr");
    tr.appendChild(el("td", { colspan: "8" }, "Tidak ada koridor yang cocok."));
    tbody.appendChild(tr);
  }
  $("fleet-foot").textContent =
    `${fmt.format(rows.length)} koridor · Slot overload = halte-jam dengan ≥ ${state.assumptions.overload} penumpang. ` +
    `Rata² peak = penumpang per jam per hari di periode tsb.`;
}

init().catch((err) => {
  console.error(err);
  document.body.classList.remove("loading");
  $("kpis").textContent = "Gagal memuat data dashboard. Coba refresh halaman.";
});
