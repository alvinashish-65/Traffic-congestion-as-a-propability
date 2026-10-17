// Read-only dashboard. Uses ../results/data.js (window.RESULTS) when present,
// otherwise falls back to fetching the CSV files (needs a local web server).
const fmt = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? "n/a" : Number(v).toFixed(d);
const esc = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const yesNo = v => v === true ? "Yes" : v === false ? "No" : "n/a";

function parseCSVLine(line) {
  const a = []; let s = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { s += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { a.push(s); s = ""; }
    else s += c;
  }
  a.push(s); return a;
}
function convert(v) {
  if (v === "NA" || v === "" || v === "NaN") return null;
  if (v === "TRUE") return true;
  if (v === "FALSE") return false;
  const n = Number(v);
  return Number.isFinite(n) && v.trim() !== "" ? n : v;
}
async function loadCSV(name) {
  const res = await fetch("../results/" + name);
  if (!res.ok) throw Error("Could not load " + name + " (HTTP " + res.status + ").");
  const lines = (await res.text()).trim().split(/\r?\n/);
  const head = parseCSVLine(lines.shift());
  return lines.map(l => Object.fromEntries(parseCSVLine(l).map((v, i) => [head[i], convert(v)])));
}
async function loadAll() {
  if (window.RESULTS) return window.RESULTS;
  const [plain, signal, ranking, settings] = await Promise.all([
    loadCSV("plain_queue_results.csv"), loadCSV("signal_results.csv"),
    loadCSV("model_ranking.csv"), loadCSV("run_settings.csv")]);
  return { plain, signal, ranking, settings };
}

function table(id, rows, cols, format = {}, rowClass = null) {
  const el = document.getElementById(id);
  el.querySelector("thead").innerHTML = "<tr>" + cols.map(c => "<th>" + c.label + "</th>").join("") + "</tr>";
  el.querySelector("tbody").innerHTML = rows.length
    ? rows.map(r => "<tr" + (rowClass && rowClass(r) ? ' class="' + rowClass(r) + '"' : "") + ">" +
        cols.map(c => { let v = r[c.key]; v = format[c.key] ? format[c.key](v, r) : (v ?? "n/a"); return "<td>" + esc(v) + "</td>"; }).join("") + "</tr>").join("")
    : "<tr><td colspan='" + cols.length + "'>No rows available.</td></tr>";
}

let ranking = [];
function renderRanking() {
  const f = document.getElementById("study-filter").value;
  const rows = ranking.filter(r => f === "all" || r.study === f);
  table("rank-table", rows, [
    { key: "study", label: "Study" }, { key: "scope", label: "Scored on" }, { key: "rank", label: "Rank" },
    { key: "model", label: "Model" }, { key: "rows_scored", label: "Scenarios" },
    { key: "mean_absolute_percent_error", label: "Mean abs. % error" },
    { key: "mean_absolute_error_s", label: "Mean abs. error (s)" },
    { key: "fraction_inside_95ci", label: "Inside 95% CI" }, { key: "wins", label: "Closest in # scenarios" }],
    { mean_absolute_percent_error: v => fmt(v, 2) + "%", mean_absolute_error_s: v => fmt(v), fraction_inside_95ci: v => fmt(v * 100, 1) + "%" },
    r => r.rank === 1 ? "best" : "");
}

async function init() {
  try {
    const D = await loadAll();
    ranking = D.ranking;
    document.getElementById("ns-count").textContent = D.plain.length;
    document.getElementById("sig-count").textContent = D.signal.length;

    // best model per study = rank 1 of that study's first ranking scope
    const bests = ["non_signal", "signal"].map(s => ranking.find(r => r.study === s && r.rank === 1)).filter(Boolean);
    document.getElementById("best-model").textContent = bests.map(b => b.model).join(" | ") || "n/a";
    document.getElementById("best-error").textContent = bests.map(b =>
      (b.study === "signal" ? "Signal" : "Non-signal") + ": " + fmt(b.mean_absolute_percent_error, 2) + "% mean error").join(" · ");

    table("ns-table", D.plain, [
      { key: "scenario", label: "Scenario" }, { key: "lanes", label: "Lanes" }, { key: "rho", label: "Utilisation" },
      { key: "service_type", label: "True service" }, { key: "model", label: "Model" },
      { key: "analytic_mean_wait_s", label: "Predicted wait (s)" }, { key: "simulated_mean_wait_s", label: "Simulated mean (s)" },
      { key: "percent_error", label: "Error (%)" }, { key: "inside_simulated_ci95", label: "Inside 95% CI" },
      { key: "assumption_matches", label: "Service assumption matches" }, { key: "best_in_scenario", label: "Closest" }],
      { rho: v => fmt(v, 2), analytic_mean_wait_s: v => fmt(v), simulated_mean_wait_s: v => fmt(v),
        percent_error: v => v === null ? "n/a (model does not apply)" : fmt(v, 2) + "%",
        inside_simulated_ci95: (v, r) => r.applicable ? yesNo(v) : "n/a", assumption_matches: yesNo, best_in_scenario: v => v ? "Best" : "" },
      r => r.best_in_scenario ? "best" : (r.applicable ? "" : "na"));

    table("sig-table", D.signal, [
      { key: "scenario", label: "Scenario" }, { key: "lambda", label: "Arrival rate (veh/s)" },
      { key: "degree_of_saturation", label: "Degree of saturation" }, { key: "model", label: "Model" },
      { key: "q0_estimate", label: "Q(0) estimate" }, { key: "analytic_mean_wait_s", label: "Predicted wait (s)" },
      { key: "simulated_mean_wait_s", label: "Simulated mean (s)" }, { key: "percent_error", label: "Error (%)" },
      { key: "inside_simulated_ci95", label: "Inside 95% CI" }, { key: "best_in_scenario", label: "Closest" }],
      { lambda: v => fmt(v, 2), degree_of_saturation: v => fmt(v, 2), q0_estimate: (v, r) => r.model === "Harahap Eq.3.7" ? fmt(v, 2) : "not used",
        analytic_mean_wait_s: v => fmt(v, 2), simulated_mean_wait_s: v => fmt(v, 2), percent_error: v => fmt(v, 2) + "%",
        inside_simulated_ci95: yesNo, best_in_scenario: v => v ? "Best" : "" },
      r => r.best_in_scenario ? "best" : "");

    table("summary-table", D.settings, [{ key: "setting", label: "Setting" }, { key: "value", label: "Value" }]);
    renderRanking();
    document.getElementById("study-filter").addEventListener("change", renderRanking);
  } catch (e) {
    document.querySelectorAll("tbody").forEach(t => t.innerHTML = "<tr><td>" + esc(e.message) +
      " Run run_simulation.R first (it writes results/data.js), or start a local web server in the project folder and open /dashboard/.</td></tr>");
  }
}
init();