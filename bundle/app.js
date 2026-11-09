// RealCryptoCap Market Brief. Anna App UI bundle.
// Talks to the bundled Executa through the Anna host tools.invoke RPC.
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const TOOL_ID = "tool-dev-realcryptocap-market-brief";
const STORAGE_KEY = "rcc-brief:last";

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

function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return { text: "n/a", cls: "flat" };
  const v = Number(n);
  const cls = v > 0 ? "up" : v < 0 ? "down" : "flat";
  return { text: (v > 0 ? "+" : "") + v.toFixed(2) + "%", cls };
}

function syncChips() {
  document.querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("on", selected.has(c.dataset.id));
  });
}

function currentIds() {
  const typed = ($("coin-input").value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const merged = [...selected, ...typed];
  return [...new Set(merged)].slice(0, 8);
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

  $("brief-text").textContent = data.brief || "No brief produced.";

  const rows = $("price-rows");
  rows.innerHTML = "";
  (data.coins || []).forEach((c) => {
    const pct = fmtPct(c.change_24h_pct);
    const el = document.createElement("div");
    el.className = "row";
    el.innerHTML =
      '<div><span class="rank"></span><span class="name"></span><span class="sym"></span></div>' +
      '<div class="pc"><div class="price"></div><div class="cap"></div></div><div class="chg"></div>';
    el.querySelector(".name").textContent = c.name || c.id || "";
    el.querySelector(".sym").textContent = c.symbol || "";
    el.querySelector(".rank").textContent = c.rank != null ? "#" + c.rank : "";
    el.querySelector(".cap").textContent = c.not_found || c.market_cap == null ? "" : "MCap " + fmtUsd(c.market_cap);
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
    if (n.source) {
      const s = document.createElement("span");
      s.className = "src";
      s.textContent = n.source;
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
    setState("error", "Pick at least one coin.");
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
      args: { coin_ids: ids.join(",") },
    });
    const payload = (out && out.data) || out || {};
    const data = payload.data && payload.brief === undefined ? payload.data : payload;
    render(data);
    setState("hidden");
    try {
      await anna.storage.set({ key: STORAGE_KEY, value: { at: Date.now(), ids, data } });
    } catch (_) {}
    if (data && data.upgrade) {
      $("quota").textContent = data.upgrade;
    }
  } catch (e) {
    setState("error", "Could not generate the brief: " + (e && e.message ? e.message : String(e)));
  } finally {
    btn.disabled = false;
  }
}

async function main() {
  // Chips
  document.querySelectorAll(".chip").forEach((c) => {
    c.addEventListener("click", () => {
      const id = c.dataset.id;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      syncChips();
    });
  });
  syncChips();

  // Standalone preview (no Anna host): still show the shell.
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
    return;
  }

  // Restore last brief so the window is useful on re-open.
  try {
    const saved = await anna.storage.get({ key: STORAGE_KEY });
    const val = saved && (saved.value !== undefined ? saved.value : saved);
    if (val && val.data) {
      render(val.data);
      if (val.ids && val.ids.length) {
        selected = new Set(val.ids.filter((i) => ["bitcoin", "ethereum", "solana", "dogecoin", "chainlink"].includes(i)));
        syncChips();
      }
    }
  } catch (_) {}

  $("generate").addEventListener("click", generate);
  $("coin-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") generate();
  });
}

main();
