// Read-only dashboard. Uses ../results/data.js (window.RESULTS) when present,
// otherwise falls back to fetching the CSV files (needs a local web server).
"use strict";
const $ = id => document.getElementById(id);
const fin = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const fmt = (v, d = 3) => fin(v) ? Number(v).toFixed(d) : "n/a";
const pct = (v, d = 1) => fin(v) ? (v > 0 ? "+" : "") + Number(v).toFixed(d) + "%" : "n/a";
const esc = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const yesNo = v => v === true ? "Yes" : v === false ? "No" : "n/a";
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
const uniq = a => [...new Set(a)];

// Fixed model -> colour slot (never reassigned by filters). Dash patterns are a second cue,
// because several models give identical predictions in some scenarios and their lines overlap.
const MODELS = {
  "M/M/1":          { c: "var(--s1)", dash: "" },
  "M/M/c":          { c: "var(--s2)", dash: "7 4" },
  "M/D/c":          { c: "var(--s3)", dash: "" },
  "M/G/1":          { c: "var(--s4)", dash: "2 3" },
  "M/G/c":          { c: "var(--s5)", dash: "10 3 2 3" },
  "Webster":        { c: "var(--s1)", dash: "" },
  "Harahap Eq.3.7": { c: "var(--s2)", dash: "7 4" }
};
const NS_MODELS = ["M/M/1", "M/M/c", "M/D/c", "M/G/1", "M/G/c"];
const SVC_LABEL = { exponential: "Exponential service", deterministic: "Deterministic service", "gamma_cv2_0.25": "Gamma service (CV² 0.25)" };

// ---------------- data loading ----------------
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

// ---------------- tables ----------------
function table(id, rows, cols, rowClass = null) {
  const el = $(id);
  el.querySelector("thead").innerHTML = "<tr>" + cols.map(c => `<th${c.num ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("") + "</tr>";
  el.querySelector("tbody").innerHTML = rows.length
    ? rows.map(r => {
        const cls = rowClass ? rowClass(r) : "";
        return `<tr${cls ? ` class="${cls}"` : ""}>` + cols.map(c => {
          const v = c.fmt ? c.fmt(r[c.key], r) : (r[c.key] ?? "n/a");
          return `<td${c.num ? ' class="num"' : ""}>${c.html ? v : esc(v)}</td>`;
        }).join("") + "</tr>";
      }).join("")
    : `<tr><td colspan="${cols.length}">No rows match these filters.</td></tr>`;
}

// ---------------- SVG line chart with crosshair tooltip ----------------
const NS = "http://www.w3.org/2000/svg";
function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
// opts: { w, h, x:[lo,hi], y:[lo,hi], xs:[data x positions], series:[{name, c, dash, pts:[[x,y]]}],
//         band:[[x,lo,hi]], zero:bool, vline:{x,label}, xFmt, yFmt, xTitle, yTitle, labels:bool, tip:(x)=>{title, rows:[{c,dash,v,name}]} }
function lineChart(host, o) {
  const m = { l: 50, r: o.labels ? 118 : 14, t: 12, b: 40 };
  const W = o.w, H = o.h, pw = W - m.l - m.r, ph = H - m.t - m.b;
  const X = v => m.l + pw * (v - o.x[0]) / (o.x[1] - o.x[0]);
  const Y = v => m.t + ph - ph * (Math.min(Math.max(v, o.y[0]), o.y[1]) - o.y[0]) / (o.y[1] - o.y[0]);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "chart")}">`;
  s += '<g class="grid">' + niceTicks(o.y[0], o.y[1], 5).map(v => `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("") + "</g>";
  s += niceTicks(o.y[0], o.y[1], 5).map(v => `<text x="${m.l - 7}" y="${Y(v) + 4}" text-anchor="end">${o.yFmt(v)}</text>`).join("");
  s += '<g class="axis">' + `<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}"/>` +
       o.xs.map(v => `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t + ph}" y2="${m.t + ph + 4}"/>`).join("") + "</g>";
  s += o.xs.map(v => `<text x="${X(v)}" y="${m.t + ph + 17}" text-anchor="middle">${o.xFmt(v)}</text>`).join("");
  s += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" style="fill:var(--ink-2)">${esc(o.xTitle)}</text>`;
  s += `<text transform="translate(12 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" style="fill:var(--ink-2)">${esc(o.yTitle)}</text>`;
  if (o.vline) s += `<line x1="${X(o.vline.x)}" x2="${X(o.vline.x)}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--axis)" stroke-dasharray="3 3"/>` +
                    `<text x="${X(o.vline.x) - 5}" y="${m.t + 12}" text-anchor="end">${esc(o.vline.label)}</text>`;
  if (o.band && o.band.length) {
    const up = o.band.map(b => `${X(b[0])},${Y(b[2])}`), dn = o.band.slice().reverse().map(b => `${X(b[0])},${Y(b[1])}`);
    s += `<polygon points="${up.concat(dn).join(" ")}" fill="var(--band)"/>`;
  }
  if (o.zero) s += `<line class="zero" x1="${m.l}" x2="${m.l + pw}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  o.series.forEach(se => {
    if (!se.pts.length) return;
    s += `<polyline fill="none" stroke="${se.c}" stroke-width="${se.w || 2}" stroke-dasharray="${se.dash || ""}" stroke-linejoin="round" stroke-linecap="round" points="${se.pts.map(p => X(p[0]) + "," + Y(p[1])).join(" ")}"/>`;
    s += se.pts.map(p => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${se.r || 3.5}" fill="${se.c}" stroke="var(--surface)" stroke-width="2"/>`).join("");
  });
  if (o.labels) {   // direct labels at the right end, merged when lines coincide and nudged apart
    let L = o.series.filter(se => se.pts.length).map(se => ({ name: se.name, c: se.c, y: Y(se.pts[se.pts.length - 1][1]) }));
    L.sort((a, b) => a.y - b.y);
    const merged = []; L.forEach(l => { const p = merged[merged.length - 1]; if (p && Math.abs(p.y - l.y) < 1) p.name += " = " + l.name; else merged.push({ ...l }); });
    for (let i = 1; i < merged.length; i++) merged[i].y = Math.max(merged[i].y, merged[i - 1].y + 14);
    const x1 = m.l + pw + 8;
    s += merged.map(l => `<text x="${x1}" y="${l.y + 4}" style="fill:var(--ink-2);font-weight:600">${esc(l.name)}</text>`).join("");
  }
  s += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="var(--ink-2)" stroke-width="1" visibility="hidden"/>`;
  s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" tabindex="0"/>`;
  s += "</svg>";
  host.innerHTML = s;
  const svg = host.querySelector("svg"), xh = svg.querySelector(".xh"), hit = svg.querySelector(".hit"), tip = $("tip");
  const show = (xv, cx, cy) => {
    xh.setAttribute("x1", X(xv)); xh.setAttribute("x2", X(xv)); xh.setAttribute("visibility", "visible");
    const t = o.tip(xv); tip.textContent = "";
    const head = document.createElement("div"); head.className = "t"; head.textContent = t.title; tip.appendChild(head);
    t.rows.forEach(r => {
      const row = document.createElement("div"); row.className = "row";
      const k = document.createElement("i"); k.className = "key" + (r.dash ? " dash" : ""); k.style.borderTopColor = r.c || "var(--sim)";
      const b = document.createElement("b"); b.textContent = r.v;
      const sp = document.createElement("span"); sp.textContent = r.name;
      row.append(k, b, sp); tip.appendChild(row);
    });
    tip.style.display = "block";
    const tw = tip.offsetWidth, left = cx + 14 + tw > window.scrollX + document.documentElement.clientWidth ? cx - tw - 14 : cx + 14;
    tip.style.left = left + "px"; tip.style.top = (cy + 12) + "px";
  };
  const hide = () => { xh.setAttribute("visibility", "hidden"); tip.style.display = "none"; };
  const nearest = px => o.xs.reduce((b, v) => Math.abs(X(v) - px) < Math.abs(X(b) - px) ? v : b, o.xs[0]);
  hit.addEventListener("pointermove", e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width;
    show(nearest(px), e.pageX, e.pageY);
  });
  hit.addEventListener("pointerleave", hide);
  let fi = 0;
  hit.addEventListener("focus", () => { const r = svg.getBoundingClientRect(); show(o.xs[fi], r.left + window.scrollX + r.width / 2, r.top + window.scrollY + 20); });
  hit.addEventListener("blur", hide);
  hit.addEventListener("keydown", e => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    fi = Math.max(0, Math.min(o.xs.length - 1, fi + (e.key === "ArrowRight" ? 1 : -1))); hit.dispatchEvent(new Event("focus")); e.preventDefault();
  });
}
function legend(id, items) {
  $(id).innerHTML = items.map(i => `<span><i class="key${i.dash ? " dash" : ""}" style="border-top-color:${i.c};${i.w ? "border-top-width:" + i.w + "px" : ""}"></i>${esc(i.name)}</span>`).join("");
}

// ---------------- rankings ----------------
// rank-1 model of a scope, joined with any model tied with it (several formulas coincide on 1 lane)
function winners(ranking, scopeStart) {
  const rows = ranking.filter(r => r.scope.startsWith(scopeStart)); if (!rows.length) return null;
  const top = rows.find(r => r.rank === 1), tied = rows.filter(r => Math.abs(r.mean_absolute_percent_error - top.mean_absolute_percent_error) < 1e-9);
  return { ...top, label: tied.map(r => r.model).sort().join(" = ") };
}

// ---------------- sections ----------------
function renderFacets(plain) {
  const svcs = uniq(plain.map(r => r.service_type)), lanes = uniq(plain.map(r => r.lanes)).sort();
  const rhos = uniq(plain.map(r => r.rho)).sort((a, b) => a - b);
  const app = plain.filter(r => r.applicable);
  const ys = app.map(r => r.percent_error);
  const y = [Math.floor(Math.min(-10, ...ys) / 20) * 20, Math.ceil(Math.max(10, ...ys) / 20) * 20];
  legend("ns-legend", [{ name: "Simulation (0% error) with 95% CI band", c: "var(--sim)", w: 2 }]
    .concat(NS_MODELS.map(k => ({ name: k, c: MODELS[k].c, dash: MODELS[k].dash }))));
  const host = $("ns-facets"); host.innerHTML = "";
  lanes.forEach(ln => svcs.forEach(sv => {
    const rows = app.filter(r => r.lanes === ln && r.service_type === sv);
    const card = document.createElement("div"); card.className = "card facet";
    const h = document.createElement("h3"); h.textContent = (SVC_LABEL[sv] || sv) + " · " + ln + (ln === 1 ? " lane" : " lanes");
    const note = document.createElement("div"); note.className = "muted"; note.style.minHeight = "20px";
    // which models give identical numbers here (their lines overlap)
    const sig = {}; uniq(rows.map(r => r.model)).forEach(mdl => { const k = rows.filter(r => r.model === mdl).map(r => r.analytic_mean_wait_s.toFixed(9)).join(); (sig[k] = sig[k] || []).push(mdl); });
    const same = Object.values(sig).filter(g => g.length > 1).map(g => g.join(" = "));
    note.textContent = same.length ? "Same formula here: " + same.join("; ") : "";
    const ch = document.createElement("div"); ch.className = "chart";
    card.append(h, note, ch); host.appendChild(card);
    const series = NS_MODELS.map(mdl => ({ name: mdl, c: MODELS[mdl].c, dash: MODELS[mdl].dash,
      pts: rows.filter(r => r.model === mdl).sort((a, b) => a.rho - b.rho).map(r => [r.rho, r.percent_error]) }));
    const one = rhos.map(rho => rows.find(r => r.rho === rho)).filter(Boolean);
    const band = one.map(r => [r.rho, 100 * (r.simulated_ci95_lower_s / r.simulated_mean_wait_s - 1), 100 * (r.simulated_ci95_upper_s / r.simulated_mean_wait_s - 1)]);
    lineChart(ch, { w: 380, h: 250, x: [0.25, 0.9], y, xs: rhos, series, band, zero: true,
      aria: h.textContent + ": percent error by utilisation",
      xFmt: v => v.toFixed(2), yFmt: v => (v > 0 ? "+" : "") + v + "%", xTitle: "utilisation per server ρ", yTitle: "error vs simulation",
      tip: xv => {
        const at = rows.filter(r => r.rho === xv), s0 = at[0];
        return { title: `ρ = ${xv} · simulated ${fmt(s0.simulated_mean_wait_s)} s`,
          rows: at.map(r => ({ c: MODELS[r.model].c, dash: MODELS[r.model].dash, v: pct(r.percent_error), name: `${r.model} (${fmt(r.analytic_mean_wait_s)} s)` })) };
      } });
  }));
}

function renderSignal(signal) {
  const lams = uniq(signal.map(r => r.lambda)).sort((a, b) => a - b);
  const sim = lams.map(l => signal.find(r => r.lambda === l));
  const all = signal.map(r => r.analytic_mean_wait_s).concat(sim.map(r => r.simulated_mean_wait_s));
  const y = [Math.floor(Math.min(...all) / 10) * 10 - 5, Math.ceil(Math.max(...all) / 10) * 10];
  const cap = sim[0] ? sim[0].departure_rate_mu * sim[0].green_s / sim[0].cycle_s : null;
  const models = uniq(signal.map(r => r.model));
  legend("sig-legend", [{ name: "Simulated mean wait (95% CI band)", c: "var(--sim)", w: 2.5 }]
    .concat(models.map(mdl => ({ name: mdl, c: MODELS[mdl].c, dash: MODELS[mdl].dash }))));
  const series = [{ name: "Simulation", c: "var(--sim)", w: 2.5, pts: sim.map(r => [r.lambda, r.simulated_mean_wait_s]) }]
    .concat(models.map(mdl => ({ name: mdl, c: MODELS[mdl].c, dash: MODELS[mdl].dash,
      pts: signal.filter(r => r.model === mdl).sort((a, b) => a.lambda - b.lambda).map(r => [r.lambda, r.analytic_mean_wait_s]) })));
  lineChart($("sig-chart"), { w: 1100, h: 360, x: [0.08, 0.43], y, xs: lams, series, labels: true,
    band: sim.map(r => [r.lambda, r.simulated_ci95_lower_s, r.simulated_ci95_upper_s]),
    vline: cap ? { x: cap, label: "capacity " + cap.toFixed(3) + " veh/s" } : null,
    aria: "Signal study: mean wait against arrival rate",
    xFmt: v => v.toFixed(2), yFmt: v => v + " s", xTitle: "arrival rate λ (veh/s)", yTitle: "mean wait (s)",
    tip: xv => {
      const at = signal.filter(r => r.lambda === xv), s0 = at[0];
      return { title: `λ = ${xv} veh/s · degree of saturation ${fmt(s0.degree_of_saturation, 2)}`,
        rows: [{ c: "var(--sim)", v: fmt(s0.simulated_mean_wait_s, 1) + " s", name: "simulated" }]
          .concat(at.map(r => ({ c: MODELS[r.model].c, dash: MODELS[r.model].dash, v: fmt(r.analytic_mean_wait_s, 1) + " s", name: `${r.model} (${pct(r.percent_error)})` }))) };
    } });
  table("sig-table", signal, [
    { key: "scenario", label: "Scenario" }, { key: "lambda", label: "Arrival rate (veh/s)", num: true, fmt: v => fmt(v, 2) },
    { key: "degree_of_saturation", label: "Degree of saturation x", num: true, fmt: v => fmt(v, 3) }, { key: "model", label: "Model" },
    { key: "q0_estimate", label: "Q(0) estimate (veh)", num: true, fmt: (v, r) => r.model === "Harahap Eq.3.7" ? fmt(v, 2) : "not used" },
    { key: "analytic_mean_wait_s", label: "Predicted (s)", num: true, fmt: v => fmt(v, 2) },
    { key: "simulated_mean_wait_s", label: "Simulated (s)", num: true, fmt: v => fmt(v, 2) },
    { key: "simulated_ci95_lower_s", label: "95% CI (s)", num: true, fmt: (v, r) => fmt(v, 2) + " – " + fmt(r.simulated_ci95_upper_s, 2) },
    { key: "percent_error", label: "Error", num: true, fmt: v => pct(v, 2) },
    { key: "inside_simulated_ci95", label: "Inside CI", fmt: yesNo },
    { key: "best_in_scenario", label: "Closest", html: true, fmt: v => v ? '<span class="tag good">closest</span>' : "" }],
    r => r.best_in_scenario ? "best" : "");
}

function renderPlainTable(plain) {
  const f = { svc: $("f-svc").value, lanes: $("f-lanes").value, rho: $("f-rho").value, model: $("f-model").value, app: $("f-app").value };
  const rows = plain.filter(r => (!f.svc || r.service_type === f.svc) && (!f.lanes || String(r.lanes) === f.lanes) &&
    (!f.rho || String(r.rho) === f.rho) && (!f.model || r.model === f.model) && (!f.app || r.applicable));
  table("ns-table", rows, [
    { key: "scenario", label: "Scenario" }, { key: "lanes", label: "Lanes", num: true }, { key: "rho", label: "ρ", num: true, fmt: v => fmt(v, 2) },
    { key: "service_type", label: "True service", fmt: v => (SVC_LABEL[v] || v).replace(" service", "") }, { key: "model", label: "Model" },
    { key: "analytic_mean_wait_s", label: "Predicted (s)", num: true, fmt: v => fmt(v) },
    { key: "simulated_mean_wait_s", label: "Simulated (s)", num: true, fmt: v => fmt(v) },
    { key: "simulated_ci95_lower_s", label: "95% CI (s)", num: true, fmt: (v, r) => fmt(v) + " – " + fmt(r.simulated_ci95_upper_s) },
    { key: "percent_error", label: "Error", num: true, fmt: v => v === null ? "n/a (does not apply)" : pct(v, 2) },
    { key: "inside_simulated_ci95", label: "Inside CI", fmt: (v, r) => r.applicable ? yesNo(v) : "n/a" },
    { key: "assumption_matches", label: "Assumption matches", fmt: yesNo },
    { key: "best_in_scenario", label: "Closest", html: true, fmt: v => v ? '<span class="tag good">closest</span>' : "" }],
    r => r.best_in_scenario ? "best" : (r.applicable ? "" : "na"));
}

let RANK = [];
function renderRanking() {
  const f = $("study-filter").value;
  table("rank-table", RANK.filter(r => f === "all" || r.study === f), [
    { key: "study", label: "Study", fmt: v => v === "signal" ? "Signal" : "Non-signal" },
    { key: "scope", label: "Scored on" },
    { key: "rank", label: "Rank", num: true }, { key: "model", label: "Model" }, { key: "rows_scored", label: "Scenarios", num: true },
    { key: "mean_absolute_percent_error", label: "Mean abs. % error", num: true, fmt: v => fmt(v, 2) + "%" },
    { key: "mean_absolute_error_s", label: "Mean abs. error (s)", num: true, fmt: v => fmt(v) },
    { key: "fraction_inside_95ci", label: "Inside 95% CI", num: true, fmt: v => fmt(v * 100, 0) + "%" },
    { key: "wins", label: "Closest in # scenarios", num: true }],
    r => r.rank === 1 ? "best" : "");
}

function renderFindings(D) {
  const P = D.plain.filter(r => r.applicable), S = D.signal, li = [];
  const w1 = winners(D.ranking, "same scenarios: 1 lane"), w2 = winners(D.ranking, "same scenarios: 2 lanes");
  const plural = w => w.label.includes("=");
  if (w1) li.push(`<b>On 1 lane, ${esc(w1.label)} ${plural(w1) ? "are" : "is"} the most accurate</b>, with a mean error of ${fmt(w1.mean_absolute_percent_error, 2)}% across ${w1.rows_scored} scenarios. That's expected, because ${plural(w1) ? "they use" : "it uses"} the true service variability. With one server, M/G/c is the same formula as M/G/1, and M/M/1 and M/D/1 are its special cases for CV² = 1 and CV² = 0.`);
  const err = (m, svc, ln) => P.filter(r => r.model === m && r.service_type.startsWith(svc) && r.lanes === ln).map(r => r.percent_error);
  const mmDet = err("M/M/c", "deterministic", 1), mdExp = err("M/D/c", "exponential", 1);
  if (mmDet.length && mdExp.length) li.push(`<b>A wrong service assumption is costly.</b> On deterministic service, the exponential models over-predict the wait by ${pct(Math.min(...mmDet), 0)} to ${pct(Math.max(...mmDet), 0)}. On exponential service, M/D/c under-predicts by about ${fmt(Math.abs(mean(mdExp)), 0)}%.`);
  const g2 = err("M/G/c", "gamma", 2);
  if (w2) li.push(`<b>On 2 lanes, ${esc(w2.label)} is the most accurate</b>, with a mean error of ${fmt(w2.mean_absolute_percent_error, 2)}%. It's the only model that fits gamma service on 2 lanes${g2.length ? ` (it under-predicts by ${fmt(Math.abs(Math.max(...g2)), 1)}% to ${fmt(Math.abs(Math.min(...g2)), 1)}%)` : ""}. On deterministic service it is the same formula as M/D/c, and on exponential service the same as M/M/c.`);
  const md2 = err("M/D/c", "deterministic", 2);
  if (md2.length) li.push(`<b>The multi-server formulas are approximations</b> (Allen–Cunneen). On deterministic service, M/D/c under-predicts by ${fmt(Math.abs(Math.max(...md2)), 1)}% to ${fmt(Math.abs(Math.min(...md2)), 1)}%, and the gap is biggest at low utilisation.`);
  const web = S.filter(r => r.model === "Webster").sort((a, b) => a.lambda - b.lambda), har = S.filter(r => r.model === "Harahap Eq.3.7").sort((a, b) => a.lambda - b.lambda);
  if (web.length && har.length) li.push(`<b>Signal: Webster is closest in ${web.filter(r => r.best_in_scenario).length} of ${web.length} scenarios.</b> It is used here with its correction term, and its error stays between ${pct(Math.min(...web.map(r => r.percent_error)), 1)} and ${pct(Math.max(...web.map(r => r.percent_error)), 1)}. Harahap eq. 3.7 has no such term, and its over-prediction grows with saturation, reaching ${pct(har[har.length - 1].percent_error, 1)} at x = ${fmt(har[har.length - 1].degree_of_saturation, 2)}.`);
  $("findings").innerHTML = li.map(x => "<li>" + x + "</li>").join("");
}

async function init() {
  try {
    const D = await loadAll();
    RANK = D.ranking;
    const set = k => (D.settings.find(s => s.setting === k) || {}).value;

    const b1 = winners(D.ranking, "same scenarios: 1 lane"), b2 = winners(D.ranking, "same scenarios: 2 lanes");
    $("t-ns").textContent = b2 ? b2.label : b1 ? b1.label : "n/a";
    $("t-ns-sub").textContent = (b2 ? `2 lanes: ${fmt(b2.mean_absolute_percent_error, 2)}% mean error` : "") + (b1 ? ` · 1 lane: ${b1.label} (${fmt(b1.mean_absolute_percent_error, 2)}%)` : "");
    const bs = D.ranking.find(r => r.study === "signal" && r.rank === 1);
    $("t-sig").textContent = bs ? bs.model : "n/a";
    $("t-sig-sub").textContent = bs ? `${fmt(bs.mean_absolute_percent_error, 2)}% mean error, closest in ${bs.wins} of ${bs.rows_scored}` : "";
    const nNS = uniq(D.plain.map(r => r.scenario)).length, nS = uniq(D.signal.map(r => r.scenario)).length;
    $("t-scen").textContent = `${nNS} + ${nS}`; $("t-scen-sub").textContent = "non-signal + signal";
    $("t-reps").textContent = `${set("nonsignal_replications")} / ${set("signal_replications")} runs`;
    $("t-reps-sub").textContent = `${set("nonsignal_horizon_s")} s per non-signal run · ${set("signal_cycles_per_rep")} cycles per signal run`;

    renderFindings(D);
    renderFacets(D.plain);
    renderSignal(D.signal);

    const opts = (id, vals, lab = v => v) => vals.forEach(v => { const o = document.createElement("option"); o.value = v; o.textContent = lab(v); $(id).appendChild(o); });
    opts("f-svc", uniq(D.plain.map(r => r.service_type)), v => (SVC_LABEL[v] || v).replace(" service", ""));
    opts("f-rho", uniq(D.plain.map(r => r.rho)).sort((a, b) => a - b));
    opts("f-model", uniq(D.plain.map(r => r.model)));
    ["f-svc", "f-lanes", "f-rho", "f-model", "f-app"].forEach(id => $(id).addEventListener("change", () => renderPlainTable(D.plain)));
    renderPlainTable(D.plain);

    table("summary-table", D.settings, [{ key: "setting", label: "Setting" }, { key: "value", label: "Value", num: true }]);
    renderRanking();
    $("study-filter").addEventListener("change", renderRanking);
    if (window.RESULTS) $("load-note").style.display = "none";
  } catch (e) {
    document.querySelectorAll("tbody").forEach(t => t.innerHTML = "<tr><td>" + esc(e.message) +
      " Run run_simulation.R first (it writes results/data.js), or start a local web server in the project folder and open /dashboard/.</td></tr>");
  }
}
init();
