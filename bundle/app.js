// RealCryptoCap Market Brief. Anna App UI bundle.
// Talks to the bundled Executa through the Anna host tools.invoke RPC.
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const TOOL_ID = "tool-jasonparser-realcryptocap-market-brief-srwkkp4n";
const STORAGE_KEY = "rcc-brief:last";
const WATCH_KEY = "rcc:watchlist";
const PREFS_KEY = "rcc:prefs";
const HIST_KEY = "rcc:history";
const HIST_MAX = 20;
const VISIT_KEY = "rcc:visit";
let visit = null;
const DEFAULT_WATCH = ["bitcoin", "ethereum", "solana", "dogecoin", "chainlink"];
const SYMBOLS = { bitcoin: "BTC", ethereum: "ETH", solana: "SOL", dogecoin: "DOGE", chainlink: "LINK", ripple: "XRP", cardano: "ADA", binancecoin: "BNB", tron: "TRX", avalanche_2: "AVAX" };

let watchlist = DEFAULT_WATCH.slice();
let prefs = { style: "short", focus: "balanced" };
let history = [];

const $ = (id) => document.getElementById(id);

let anna = null;
let selected = new Set(["bitcoin", "ethereum", "solana"]);

function setState(kind, msg) {
  const box = $("state");
  const spinner = $("spinner");
  const text = $("state-msg");
  if (kind === "hidden") {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.classList.toggle("error", kind === "error");
  spinner.hidden = kind !== "loading";
  text.textContent = msg || "";
}

function fmtUsd(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "n/a";
  const v = Number(n);
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (v >= 1) return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return "$" + v.toPrecision(4);
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false }) + " UTC";
}

function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return { text: "n/a", cls: "flat" };
  const v = Number(n);
  const cls = v > 0 ? "up" : v < 0 ? "down" : "flat";
  return { text: (v > 0 ? "+" : "") + v.toFixed(2) + "%", cls };
}

function symOf(id) {
  return SYMBOLS[id] || id.toUpperCase().slice(0, 6);
}

let saveChain = Promise.resolve();
function save(key, value) {
  if (!anna) return Promise.resolve();
  const snapshot = JSON.parse(JSON.stringify(value));
  saveChain = saveChain.then(() => anna.storage.set({ key, value: snapshot })).catch(() => {});
  return saveChain;
}

async function load(key) {
  if (!anna) return undefined;
  try {
    const r = await anna.storage.get({ key });
    return r && r.value !== undefined ? r.value : r;
  } catch (_) { return undefined; }
}

function renderChips() {
  const box = $("chips");
  box.innerHTML = "";
  watchlist.forEach((id) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (selected.has(id) ? " on" : "");
    chip.dataset.id = id;
    chip.title = id;
    const t = document.createElement("button");
    t.type = "button";
    t.className = "chip-t";
    t.textContent = symOf(id);
    t.addEventListener("click", () => {
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      renderChips();
    });
    const x = document.createElement("button");
    x.type = "button";
    x.className = "chip-x";
    x.setAttribute("aria-label", "Remove " + id);
    x.textContent = "×";
    x.addEventListener("click", () => {
      watchlist = watchlist.filter((w) => w !== id);
      selected.delete(id);
      renderChips();
      save(WATCH_KEY, watchlist);
    });
    chip.appendChild(t);
    chip.appendChild(x);
    box.appendChild(chip);
  });
  if (!watchlist.length) {
    const p = document.createElement("span");
    p.className = "hint";
    p.textContent = "Your watchlist is empty. Add a coin below.";
    box.appendChild(p);
  }
}

function addCoins() {
  const ids = ($("coin-input").value || "").split(",").map((s) => s.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
  ids.forEach((id) => {
    if (!watchlist.includes(id) && watchlist.length < 20) watchlist.push(id);
    selected.add(id);
  });
  $("coin-input").value = "";
  renderChips();
  save(WATCH_KEY, watchlist);
  loadUpdates(false);
}

function currentIds() {
  return watchlist.filter((id) => selected.has(id)).slice(0, 8);
}

function previousSnapshot(data) {
  const at = data && data.meta && data.meta.fetched_at_utc;
  return history.find((h) => h.fetched !== at) || null;
}

function renderHistory() {
  const ul = $("history");
  ul.innerHTML = "";
  if (!history.length) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "No briefs yet.";
    ul.appendChild(li);
    return;
  }
  history.forEach((h) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hist-item";
    const coins = (h.ids || []).map(symOf).join(", ");
    btn.textContent = fmtTime(new Date(h.at).toISOString()) + " · " + coins + " · " + (h.prefs ? h.prefs.style + "/" + h.prefs.focus : "");
    btn.addEventListener("click", () => {
      if (h.data) { render(h.data); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

async function recordHistory(ids, data) {
  const prices = {};
  (data.coins || []).forEach((c) => { if (c.id && c.price) prices[c.id] = c.price; });
  const entry = { at: Date.now(), fetched: data.meta && data.meta.fetched_at_utc, ids, prefs: { ...prefs }, prices, data };
  history = [entry, ...history].slice(0, HIST_MAX);
  await save(HIST_KEY, history);
  renderHistory();
}

function render(data) {
  const briefBox = $("brief");
  const emptyBox = $("empty");
  if (!data) {
    briefBox.hidden = true;
    emptyBox.hidden = false;
    return;
  }
  emptyBox.hidden = true;
  briefBox.hidden = false;

  const badge = $("badge");
  badge.textContent = data.ai_composed ? "AI composed" : "AI analysis";
  badge.classList.toggle("fallback", !data.ai_composed);

  const meta = data.meta || {};
  const full = data.brief || "No brief produced.";
  $("brief-text").textContent = full.split("\n\nData: ")[0];
  $("asof").textContent = meta.data_as_of_utc
    ? "Prices as of " + fmtTime(meta.data_as_of_utc) + " · refreshes every 1-2 min"
    : "";
  const method = $("method");
  method.innerHTML = "";
  [
    ["Source", meta.source],
    ["Data as of", meta.data_as_of_utc ? fmtTime(meta.data_as_of_utc) : null],
    ["Fetched", meta.fetched_at_utc ? fmtTime(meta.fetched_at_utc) : null],
    ["Refresh", meta.refresh],
    ["Key levels", meta.levels_basis],
    ["Note", "AI-written summary of the data above. Not investment advice."],
  ].forEach(([k, v]) => {
    if (!v) return;
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = k + ": ";
    li.appendChild(b);
    li.appendChild(document.createTextNode(v));
    method.appendChild(li);
  });

  const srcList = $("sources");
  srcList.innerHTML = "";
  (data.sources || []).forEach((src) => {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = src.name + ": ";
    li.appendChild(b);
    li.appendChild(document.createTextNode([src.url, src.access, src.upstream, src.refresh, src.fetched].filter(Boolean).join(" ")));
    srcList.appendChild(li);
  });

  const prev = previousSnapshot(data);
  const rows = $("price-rows");
  rows.innerHTML = "";
  (data.coins || []).forEach((c) => {
    const pct = fmtPct(c.change_24h_pct);
    const el = document.createElement("div");
    el.className = "row";
    el.innerHTML =
      '<div><div><span class="rank"></span><span class="name"></span><span class="sym"></span></div><div class="lv"></div></div>' +
      '<div class="pc"><div class="price"></div><div class="cap"></div></div><div class="chg"></div>';
    el.querySelector(".name").textContent = c.name || c.id || "";
    el.querySelector(".sym").textContent = c.symbol || "";
    el.querySelector(".rank").textContent = c.rank != null ? "#" + c.rank : "";
    const lv = c.levels;
    el.querySelector(".lv").textContent = lv
      ? "Support " + fmtUsd(lv.support) + " · Resistance " + fmtUsd(lv.resistance) + " (" + lv.basis + ")"
      : "";
    let capTxt = c.not_found || c.market_cap == null ? "" : "MCap " + fmtUsd(c.market_cap);
    const p0 = prev && prev.prices && prev.prices[c.id];
    if (p0 && c.price) {
      const d = ((c.price - p0) / p0) * 100;
      capTxt += " · " + (d >= 0 ? "+" : "") + d.toFixed(2) + "% since " + fmtTime(new Date(prev.at).toISOString());
    }
    el.querySelector(".cap").textContent = capTxt;
    el.querySelector(".price").textContent = c.not_found ? "not in native universe" : fmtUsd(c.price);
    const chg = el.querySelector(".chg");
    chg.textContent = pct.text;
    chg.classList.add(pct.cls);
    rows.appendChild(el);
  });

  const news = $("news");
  news.innerHTML = "";
  (data.news || []).forEach((n) => {
    const li = document.createElement("li");
    if (n.url) {
      const a = document.createElement("a");
      a.href = n.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = n.title || "";
      li.appendChild(a);
    } else {
      li.textContent = n.title || "";
    }
    if (n.source || n.date) {
      const s = document.createElement("span");
      s.className = "src";
      s.textContent = [n.source, n.published_utc ? fmtTime(n.published_utc) : n.date].filter(Boolean).join(" · ");
      li.appendChild(s);
    }
    news.appendChild(li);
  });
  if (!(data.news || []).length) {
    const li = document.createElement("li");
    li.textContent = "No headlines right now.";
    news.appendChild(li);
  }

  const foot = $("brief");
  void foot;
}

async function generate() {
  const ids = currentIds();
  if (!ids.length) {
    setState("error", "Select at least one coin from your watchlist.");
    return;
  }
  const btn = $("generate");
  btn.disabled = true;
  setState("loading", "Fetching live data and composing the brief...");
  $("brief").hidden = true;
  $("empty").hidden = true;

  try {
    const out = await anna.tools.invoke({
      tool_id: TOOL_ID,
      method: "get_ai_summary",
      args: { coin_ids: ids.join(","), style: prefs.style, focus: prefs.focus },
    });
    const payload = (out && out.data) || out || {};
    const data = payload.data && payload.brief === undefined ? payload.data : payload;
    render(data);
    setState("hidden");
    await recordHistory(ids, data);
    if (data && data.upgrade) {
      $("quota").textContent = data.upgrade;
    }
  } catch (e) {
    setState("error", "Could not generate the brief: " + (e && e.message ? e.message : String(e)));
  } finally {
    btn.disabled = false;
  }
}

function newsItem(n) {
  const li = document.createElement("li");
  if (n.url) {
    const a = document.createElement("a");
    a.href = n.url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = n.title || "";
    li.appendChild(a);
  } else {
    li.textContent = n.title || "";
  }
  const s = document.createElement("span");
  s.className = "src";
  s.textContent = [n.source, n.published_utc ? fmtTime(n.published_utc) : null].filter(Boolean).join(" · ");
  li.appendChild(s);
  return li;
}

function renderUpdates(u) {
  const since = u.since_utc;
  $("upd-title").textContent = since ? "Since your last visit" : "What's new for your watchlist";
  $("upd-asof").textContent =
    (since ? "Changes since " + fmtTime(since) + " · " : "First visit: showing the last 48h of news · ") +
    "prices as of " + (u.meta && u.meta.data_as_of_utc ? fmtTime(u.meta.data_as_of_utc) : "n/a") +
    " · source: RealCryptoCap";
  const box = $("upd-coins");
  box.innerHTML = "";
  (u.coins || []).forEach((c) => {
    if (c.not_found) return;
    const card = document.createElement("div");
    card.className = "upd-card" + ((c.highlights || []).length ? " hot" : "");
    const head = document.createElement("div");
    head.className = "upd-head";
    const nm = document.createElement("span");
    nm.className = "name";
    nm.textContent = (c.rank != null ? "#" + c.rank + " " : "") + (c.name || c.id) + " ";
    const sym = document.createElement("span");
    sym.className = "sym";
    sym.textContent = c.symbol || "";
    nm.appendChild(sym);
    const px = document.createElement("span");
    px.className = "upd-px";
    let txt = fmtUsd(c.price);
    if (c.change_since_last_visit_pct != null) {
      txt += "  " + (c.change_since_last_visit_pct >= 0 ? "+" : "") + c.change_since_last_visit_pct.toFixed(2) + "% since last visit";
      px.classList.add(c.change_since_last_visit_pct >= 0 ? "up" : "down");
    } else {
      const p = fmtPct(c.change_24h_pct);
      txt += "  " + p.text + " 24h";
      px.classList.add(p.cls);
    }
    px.textContent = txt;
    head.appendChild(nm);
    head.appendChild(px);
    card.appendChild(head);
    if ((c.highlights || []).length) {
      const hl = document.createElement("div");
      hl.className = "upd-hl";
      hl.textContent = c.highlights.join(" · ");
      card.appendChild(hl);
    }
    const ul = document.createElement("ul");
    ul.className = "news";
    (c.news || []).forEach((n) => ul.appendChild(newsItem(n)));
    if (!(c.news || []).length) {
      const li = document.createElement("li");
      li.textContent = "No new headlines mentioning " + (c.symbol || c.name) + (since ? " since your last visit." : " in the last 48h.");
      ul.appendChild(li);
    }
    card.appendChild(ul);
    box.appendChild(card);
  });
  const mk = $("upd-market");
  mk.innerHTML = "";
  (u.market_news_since || []).forEach((n) => mk.appendChild(newsItem(n)));
  $("upd-market-h").hidden = !(u.market_news_since || []).length;
}

async function loadUpdates(markVisit) {
  if (!anna || !watchlist.length) {
    $("upd-asof").textContent = watchlist.length ? "" : "Add coins to your watchlist to see updates here.";
    return;
  }
  $("upd-asof").textContent = "Checking what changed for your watchlist...";
  try {
    const out = await anna.tools.invoke({
      tool_id: TOOL_ID,
      method: "get_watchlist_updates",
      args: {
        coin_ids: watchlist.slice(0, 12).join(","),
        since: visit && visit.at ? new Date(visit.at).toISOString() : "",
        prev_prices: JSON.stringify((visit && visit.prices) || {}),
      },
    });
    const payload = (out && out.data) || out || {};
    const u = payload.coins === undefined && payload.data ? payload.data : payload;
    renderUpdates(u);
    if (markVisit) {
      const prices = {};
      (u.coins || []).forEach((c) => { if (c.id && c.price) prices[c.id] = c.price; });
      visit = { at: Date.now(), prices };
      save(VISIT_KEY, visit);
    }
  } catch (e) {
    $("upd-asof").textContent = "Could not load updates: " + (e && e.message ? e.message : String(e));
  }
}

async function main() {
  renderChips();
  try {
    anna = await AnnaAppRuntime.connect();
    await anna.window.set_title({ title: "RealCryptoCap Market Brief" });
    await anna.window.ready();
    setState("hidden");
  } catch (_) {
    anna = null;
    setState("error", "Standalone preview (no Anna host). Generate will not run.");
    $("generate").disabled = true;
    $("quota").textContent = "Open inside Anna to generate briefs.";
    renderHistory();
    return;
  }

  const w = await load(WATCH_KEY);
  if (Array.isArray(w)) watchlist = w;
  const p = await load(PREFS_KEY);
  if (p && typeof p === "object") prefs = { ...prefs, ...p };
  const v = await load(VISIT_KEY);
  if (v && typeof v === "object") visit = v;
  const hist = await load(HIST_KEY);
  if (Array.isArray(hist)) history = hist;
  selected = new Set(watchlist.slice(0, 3));
  if (history[0] && history[0].ids) selected = new Set(history[0].ids.filter((i) => watchlist.includes(i)));
  $("pref-style").value = prefs.style;
  $("pref-focus").value = prefs.focus;
  renderChips();
  renderHistory();
  if (history[0] && history[0].data) render(history[0].data);

  $("pref-style").addEventListener("change", (e) => { prefs.style = e.target.value; save(PREFS_KEY, prefs); });
  $("pref-focus").addEventListener("change", (e) => { prefs.focus = e.target.value; save(PREFS_KEY, prefs); });
  $("add-coin").addEventListener("click", addCoins);
  $("coin-input").addEventListener("keydown", (e) => { if (e.key === "Enter") addCoins(); });
  $("generate").addEventListener("click", generate);
  $("upd-refresh").addEventListener("click", () => loadUpdates(false));
  loadUpdates(true);
  $("clear-history").addEventListener("click", async () => { history = []; await save(HIST_KEY, history); renderHistory(); });
}

main();
