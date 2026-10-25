/* PennyRoute — SPA logic (vanilla JS, no build step) */

const $ = (q, el) => (el || document).querySelector(q);
const $$ = (q, el) => Array.from((el || document).querySelectorAll(q));

const fmt = (v, d = 4) =>
  v === null || v === undefined ? "n/a" : (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(d));

const esc = s => (s || "").replace(/[&<>"']/g, c =>
  c === "&" ? "&" + "amp;"
    : c === "<" ? "&" + "lt;"
    : c === ">" ? "&" + "gt;"
    : c === '"' ? "&" + "quot;"
    : "&" + "#39;");

let STATE = { active: {}, settings: {}, primary_chain: null };
let RANKED = [];
let CHAINS = [];
let MODELS = [];

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    let msg = r.status;
    try { msg = (await r.json()).detail || msg; } catch (e) {}
    throw new Error(msg);
  }
  return r.json();
}

function toast(msg, isErr) {
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

const ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 13h8V3H3zM13 21h8V11h-8zM13 7h8V3h-8zM3 21h8v-4H3z"/></svg>',
  ranking: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
  chains: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  api: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6M12 19h8"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  models: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  events: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2.5 2.5"/></svg>',
};

const NAV = [
  ["overview", "Overview", ICONS.overview],
  ["ranking", "Ranking", ICONS.ranking],
  ["chains", "Fallback chains", ICONS.chains],
  ["api", "API endpoint", ICONS.api],
  ["chat", "Chat", ICONS.chat],
  ["models", "Watchlist", ICONS.models],
  ["settings", "Settings", ICONS.settings],
  ["events", "Events", ICONS.events],
];

function buildNav() {
  $("#nav").innerHTML = NAV.map(([id, label, icon]) =>
    `<div class="nav-item" data-view="${id}">${icon}<span>${label}</span></div>`).join("");
  $$("#nav .nav-item").forEach(el =>
    el.onclick = () => { location.hash = "#/" + el.dataset.view; });
}

/* ------------------------------------------------------------------ data */

async function refreshAll() {
  [STATE] = await Promise.all([api("/api/state")]);
}

/* ---------------------------------------------------------------- views */

/* sparkline helper: area path from values */
function sparkPath(vals, w = 200, h = 34) {
  if (!vals.length) return "";
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const x = i => (i / (vals.length - 1)) * w;
  const y = v => h - 2 - ((v - min) / span) * (h - 6);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return { line: "M" + pts.join(" L"), area: "M0," + h + " L" + pts.join(" L") + " L" + w + "," + h + " Z", max, min };
}

/* donut helper: stroke-dasharray segments */
function donutSegs(parts, r = 34, c = 2 * Math.PI * r) {
  const total = parts.reduce((a, b) => a + b[1], 0) || 1;
  let acc = 0;
  return parts.map(([label, v, color]) => {
    const frac = v / total;
    const seg = { label, v, color, frac,
      dash: `${(frac * c).toFixed(1)} ${(c * (1 - frac)).toFixed(1)}`,
      offset: (-acc * c).toFixed(1) };
    acc += frac;
    return seg;
  });
}

function svgSparkline(vals, color = "var(--green)") {
  if (!vals || vals.length < 2) return "";
  const { line, area } = sparkPath(vals);
  return `<svg class="spark-svg" viewBox="0 0 200 34" preserveAspectRatio="none">
    <path d="${area}" fill="${color}" opacity="0.12"></path>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.4"></path>
  </svg>`;
}

const PALETTE = ["var(--green)", "var(--blue)", "var(--amber)", "var(--red)", "#a78bfa"];

function viewOverview() {
  const a = STATE.active;
  const order = (a.order && a.order.length) ? a.order.join(", ") : "auto";
  const primary = CHAINS.find(c => c.name === STATE.primary_chain);
  const tpsFirst = RANKED[0]?.best;
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Overview</h1><div class="sub">What is running right now, and what will run if this one fails.</div></div>
      <button class="primary" id="btn-evaluate">Evaluate now</button>
    </div>
    <div class="ov-grid">
      <div class="ov-main">
        <div id="ov-metrics" class="ov-metrics"><span class="spinner"></span></div>
        <div class="panel"><h2><span class="k">Fallback pipeline</span></h2><div id="ov-pipe"><span class="spinner"></span></div></div>
        <div class="panel"><h2><span class="k">Top 5 cheapest</span> — blended, your mix</h2><div id="ov-table"><span class="spinner"></span></div></div>
      </div>
      <div class="ov-side" id="ov-side"><span class="spinner"></span></div>
    </div>`;
  $("#btn-evaluate").onclick = async () => {
    toast("Evaluating chain…");
    try { const r = await api("/api/evaluate", { method: "POST" });
      toast(r.ok ? `OK: ${r.resolution ? r.resolution.model + " @ " + r.resolution.provider : "no healthy step"}` : "Failed: " + r.reason, !r.ok);
      await loadOverview();
    } catch (e) { toast(e.message, true); }
  };
  loadOverview();
  $("#ov-side").style.display = "grid";
}

let _ovTimer = null;

async function loadOverview() {
  const [tml, pipe, ev] = await Promise.all([
    api("/api/telemetry").catch(() => ({ points: [], avg_latency: 0 })),
    api("/api/pipeline").catch(() => ({ candidates: [] })),
    api("/api/events?limit=6").catch(() => ({ events: [] })),
  ]);
  // average latency across candidates (ms)
  const lats = (pipe.candidates || []).map(c => c.latency).filter(v => v != null);
  tml.avg_latency = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
  const a = STATE.active;

  // metric row + pipeline + table + side panel
  const blendedSeries = (tml.points || []).map(p => p.blended).filter(v => v != null);
  const last = blendedSeries.length ? blendedSeries[blendedSeries.length - 1] : null;
  const first = blendedSeries.length ? blendedSeries[0] : null;
  const delta = (last != null && first != null && first > 0) ? ((last - first) / first * 100) : null;
  const dTxt = delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% 24h` : "collecting";
  const avgLat = Math.round(tml.avg_latency || 0);

  $("#ov-metrics").innerHTML = `
    <div class="metrics" style="position:relative">
      <div class="metric spark">
        ${svgSparkline(blendedSeries, "var(--green)")}
        <div class="label">Blended $/M</div>
        <div class="value">${last != null ? fmt(last) : "—"}</div>
        <div class="sub">${esc(a.model || "—")} @ ${esc((a.order && a.order[0]) || "auto")}</div>
        <div class="delta ${delta != null && delta > 0 ? "" : "down"}">${esc(dTxt)}</div>
      </div>
      <div class="metric">
        <div class="label">Latency p50</div>
        <div class="value">${avgLat ? avgLat + "ms" : "—"}</div>
        <div class="sub">avg across chain candidates</div>
      </div>
      <div class="metric">
        <div class="label">Watchlist</div>
        <div class="value">${MODELS.length}</div>
        <div class="sub">ranked every ${STATE.settings.interval_min} min</div>
      </div>
    </div>`;

  const cands = pipe.candidates || [];
  $("#ov-pipe").innerHTML = cands.length ? `<div class="flow">` + cands.map((c, i) => {
    const isActive = c.model === a.model && c.provider === (a.order && a.order[0]);
    const lvl = i === 0 ? "Live" : i === 1 ? "Failover" : i === 2 ? "Emergency" : "Fallback";
    return `<div class="fnode ${isActive ? "active" : "standby"}">
        <div class="lbl">${isActive ? "● " : ""}${lvl}</div>
        <div class="sub">${esc(c.provider)}</div>
        <div class="m2">${esc(c.model)}</div>
        <div class="stats"><span>${c.latency != null ? Math.round(c.latency) + "ms" : "?"}</span><span>${c.tps != null ? c.tps.toFixed(0) + " tps" : "?"}</span><span>${c.uptime != null ? c.uptime.toFixed(1) + "%" : "?"}</span></div>
      </div>` + (i < cands.length - 1 ? `<div class="farrow"><span class="dash">➔</span></div>` : "");
  }).join("") + `</div>` : '<div class="empty">no candidates — configure a chain</div>';

  const maxBl = Math.max(...RANKED.map(m => m.best ? m.best.blended : 0).filter(Boolean), 0.000001);
  $("#ov-table").innerHTML = `<table><thead><tr>
      <th class="num">#</th><th>Model</th><th>Provider</th><th class="num">Health</th><th class="num">tps</th><th class="num">Blended $/M</th><th class="num">pct of max</th><th></th>
    </tr></thead><tbody>` + RANKED.slice(0, 5).map((m, i) => {
      const b = m.best; if (!b) return "";
      const pct = b.blended > 0 ? ((b.blended / maxBl) * 100).toFixed(0) : "0";
      return `<tr class="${m.slug === a.model ? "active-row" : ""}">
        <td class="num faint"><span class="badge neut">#${i + 1}</span></td>
        <td><span class="model-name">${esc(m.slug)}</span></td>
        <td><span class="prov"><span class="dot ${b.healthy ? "ok" : "bad"}"></span>${esc(b.provider)}</span></td>
        <td class="num"><span style="display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:12px"><span class="pulse" style="width:6px;height:6px"></span>${b.uptime != null ? b.uptime.toFixed(1) + "%" : "—"}</span></td>
        <td class="num"><span class="tps">${b.tps ? b.tps.toFixed(0) : "n/a"}<span class="tbar"><span style="width:${Math.min(100, Math.round((b.tps || 0) / 200 * 100))}%;background:linear-gradient(90deg,var(--green-soft),var(--blue))"></span></span></span></td>
        <td class="num"><span class="pnum">${fmt(b.blended)}</span></td>
        <td class="num"><span class="badge ${pct <= 30 ? "ok" : pct <= 70 ? "warn" : "bad"}">${pct}%</span></td>
        <td><button class="sm ghost" data-m="${esc(m.slug)}" data-p="${esc(b.provider)}">Route now</button></td>
      </tr>`;
    }).join("") + `</tbody></table>`;
  $$("#ov-table button[data-m]").forEach(btn => btn.onclick = () => applyChoice(btn.dataset.m, btn.dataset.p));

  // side panel
  const b = RANKED[0] ? RANKED[0].best : null;
  const donut = b ? donutSegs([
    ["in", b.in, "var(--blue)"],
    ["cache", b.cache, "var(--green)"],
    ["out", b.out, "var(--amber)"],
  ]) : [];
  const maxC = Math.max(...cands.map(c => c.blended || 0).filter(Boolean), 0.0001);
  $("#ov-side").innerHTML = `
    <div class="panel">
      <span class="live-pill"><span class="pulse"></span><span>Routing Engine Live</span><span class="u">· 5m</span></span>
      <div style="margin-top:12px" class="hint"><span style="font-family:var(--mono)">${esc(a.model || "—")}</span> @ <span style="font-family:var(--mono)">${esc((a.order && a.order[0]) || "—")}</span></div>
    </div>
    <div class="panel"><h2><span class="k">Blended cost</span> — 24h trend</h2>
      <div style="position:relative;height:76px">
        ${svgSparkline(blendedSeries.length > 1 ? blendedSeries : [0, 0, 0, last || 0, last || 0], "var(--green)")}
        <div style="position:absolute;left:0;bottom:0"><span class="badge ok">${last != null ? fmt(last) : "—"} $/M now</span></div>
      </div>
      <div class="hint" style="margin-top:4px">${tml.points.length} samples · engine snapshots</div>
    </div>
    <div class="panel"><h2><span class="k">Cost composition</span> — active endpoint</h2>
      ${b ? `<div class="donut-wrap">
        <svg width="86" height="86" viewBox="0 0 86 86">
          <circle cx="43" cy="43" r="34" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="11"></circle>
          ${donut.map(s => `<circle cx="43" cy="43" r="34" fill="none" stroke="${s.color}" stroke-width="11" stroke-dasharray="${s.dash}" stroke-dashoffset="${s.offset}" transform="rotate(-90 43 43)"></circle>`).join("")}
          <text x="43" y="39" text-anchor="middle" fill="var(--text)" font-size="13" font-family="var(--mono)" font-weight="600">${fmt(b.blended)}</text>
          <text x="43" y="54" text-anchor="middle" fill="var(--faint)" font-size="8" font-family="var(--mono)">$/M</text>
        </svg>
        <div class="share-list">${donut.map(s => `<div class="share-row"><span class="dot" style="background:${s.color}"></span><span class="nm">${s.label}</span><span class="bar"><span style="width:${(s.frac * 100).toFixed(0)}%;background:${s.color}"></span></span><span class="pc">${(s.frac * 100).toFixed(0)}%</span></div>`).join("")}</div>
      </div>` : '<div class="empty">no data</div>'}
    </div>
    <div class="panel"><h2><span class="k">Chain candidates</span> — cost ladder</h2>
      <div class="share-list">${cands.slice(0, 5).map((c, i) => `<div class="share-row"><span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span><span class="nm">${esc(c.provider)}</span><span class="bar"><span style="width:${((c.blended || 0) / maxC * 100).toFixed(0)}%;background:${PALETTE[i % PALETTE.length]}"></span></span><span class="pc">${c.blended != null ? fmt(c.blended) : "—"}</span></div>`).join("") || '<div class="empty">no candidates</div>'}</div>
    </div>
    <div class="panel"><h2><span class="k">Recent events</span></h2>
      <div>${ev.events.length ? ev.events.slice(0, 5).map(e => `<div class="ev-row"><span class="ts">${esc(e.ts)}</span><span class="badge ${e.event === "switch" ? "ok" : e.event === "engine_error" ? "bad" : "neut"}">${esc(e.event)}</span></div>`).join("") : '<div class="empty">no events</div>'}</div>
    </div>`;

  // live refresher: ping every 5s (lightweight: just update pill + latency)
  clearInterval(_ovTimer);
  _ovTimer = setInterval(async () => {
    try {
      const t2 = await api("/api/telemetry");
      const pts = t2.points || [];
      const lastP = pts.length ? pts[pts.length - 1] : null;
      const p2 = await api("/api/pipeline");
      const l2 = (p2.candidates || []).map(c => c.latency).filter(v => v != null);
      const la = l2.length ? Math.round(l2.reduce((a, b) => a + b, 0) / l2.length) : 0;
      const pill = document.querySelector("#ov-side .live-pill .u");
      const latE = document.querySelector("#ov-metrics .metric:nth-child(2) .value");
      if (pill) pill.textContent = "· " + (la ? la + "ms" : "—");
      if (latE) latE.textContent = la ? la + "ms" : "—";
    } catch (e) {}
  }, 5000);
}

function mixControls(id) {
  const m = STATE.settings.mix;
  return `<div class="row-ctl">
    <div><label class="field">Input %</label><input type="number" id="${id}-in" value="${Math.round(m.in * 100)}" min="0" max="100"></div>
    <div><label class="field">Cache %</label><input type="number" id="${id}-cache" value="${Math.round(m.cache * 100)}" min="0" max="100"></div>
    <div><label class="field">Output %</label><input type="number" id="${id}-out" value="${Math.round(m.out * 100)}" min="0" max="100"></div>
  </div>`;
}

function viewRanking() {
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Ranking</h1><div class="sub">Blended $/M per 1M total tokens under your real token mix. Health gate: tps ≥ ${STATE.settings.min_tps}, uptime ≥ ${STATE.settings.min_uptime}%.</div></div>
      <div><button class="ghost" id="btn-refresh">↻ Refresh</button></div>
    </div>
    <div class="panel"><h2><span class="k">Token mix</span></h2><div style="max-width:560px">${mixControls("mix")}</div></div>
    <div class="panel"><table><thead><tr>
      <th class="num">#</th><th>Model</th><th>Best provider</th><th class="num">in</th><th class="num">cache</th><th class="num">out</th><th class="num">Blended $/M</th><th class="num">tps</th><th class="num">uptime</th><th class="num">providers</th><th></th>
    </tr></thead><tbody id="rank-rows"></tbody></table></div>
    <div class="panel" id="detail-card" style="display:none"><h2><span class="k">Providers</span> — <span style="font-family:var(--mono)">${"<span id='detail-slug'></span>"}</span></h2>
      <table><thead><tr><th class="num">#</th><th>Provider</th><th class="num">in</th><th class="num">cache</th><th class="num">out</th><th class="num">Blended</th><th class="num">discount</th><th class="num">tps</th><th class="num">uptime</th><th></th><th></th></tr></thead>
      <tbody id="ep-rows"></tbody></table></div>`;
  renderRankRows();
  $("#btn-refresh").onclick = async () => {
    toast("Re-ranking (fresh fetch)…");
    RANKED = (await api("/api/rank?force=true")).models;
    renderRankRows();
  };
  ["in", "cache", "out"].forEach(k => $("#mix-" + k).oninput = async () => {
    const mi = +$("#mix-in").value / 100, mc = +$("#mix-cache").value / 100, mo = +$("#mix-out").value / 100;
    if (Math.abs(mi + mc + mo - 1) > 0.011) return;
    await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mix: { in: mi, cache: mc, out: mo } }) });
    STATE.settings.mix = { in: mi, cache: mc, out: mo };
    RANKED = (await api("/api/rank")).models;
    renderRankRows();
  });
}

function renderRankRows() {
  const cur = STATE.active.model;
  $("#rank-rows").innerHTML = RANKED.map((m, i) => {
    const b = m.best;
    if (m.error) return `<tr><td class="num">${i + 1}</td><td colspan="10" style="color:var(--red)">${esc(m.slug)}: ${esc(m.error)}</td></tr>`;
    if (!b) return `<tr><td class="num">${i + 1}</td><td><span class="model-name">${esc(m.slug)}</span></td><td colspan="9" class="faint">no endpoints</td></tr>`;
    const hc = m.healthy_count, pc = m.provider_count;
    const cls = hc === pc ? "ok" : hc > 0 ? "warn" : "bad";
    const barW = Math.min(100, Math.round((b.tps || 0) / 200 * 100));
    const barCls = b.tps >= 100 ? "ok" : b.tps >= 45 ? "warn" : "bad";
    const barColor = barCls === "ok" ? "var(--green-soft)" : barCls === "warn" ? "var(--amber)" : "var(--red)";
    return `<tr class="${m.slug === cur ? "active-row" : ""}">
      <td class="num faint">${i + 1}</td>
      <td><div class="model-name">${esc(m.slug)}</div><div class="model-sub">${esc(m.note || "")}</div></td>
      <td><span class="prov"><span class="dot ${b.healthy ? "ok" : "bad"}"></span>${esc(b.provider)}${b.cache_est ? ' <span class="mini">≈</span>' : ""}</span></td>
      <td class="num">${fmt(b.in)}</td><td class="num">${fmt(b.cache)}</td><td class="num">${fmt(b.out)}</td>
      <td class="num"><span class="pnum">${fmt(b.blended)}</span></td>
      <td class="num"><span class="tps">${b.tps ? b.tps.toFixed(0) : "n/a"}<span class="tbar"><span style="width:${barW}%;background:${barColor}"></span></span></span></td>
      <td class="num">${b.uptime ? b.uptime.toFixed(1) + "%" : "n/a"}</td>
      <td class="num"><span class="badge ${cls}">${hc}/${pc}</span></td>
      <td><button class="sm ghost" data-slug="${esc(m.slug)}">providers</button></td>
    </tr>`;
  }).join("");
  $$("#rank-rows button[data-slug]").forEach(b => b.onclick = () => loadDetail(b.dataset.slug));
}

async function loadDetail(slug) {
  $("#detail-card").style.display = "";
  $("#detail-slug").textContent = slug;
  $("#ep-rows").innerHTML = '<tr><td colspan="11"><span class="spinner"></span> loading…</td></tr>';
  try {
    const d = await api("/api/endpoints/" + encodeURIComponent(slug));
    $("#ep-rows").innerHTML = d.endpoints.map((e, i) => {
      if (e.error) return `<tr><td colspan="11" style="color:var(--red)">${esc(e.error)}</td></tr>`;
      const barW = Math.min(100, Math.round((e.tps || 0) / 200 * 100));
      const barCls = e.tps >= 100 ? "ok" : e.tps >= 45 ? "warn" : "bad";
      const barColor = barCls === "ok" ? "var(--green-soft)" : barCls === "warn" ? "var(--amber)" : "var(--red)";
      return `<tr>
        <td class="num faint">${i + 1}</td>
        <td><span class="prov"><span class="dot ${e.healthy ? "ok" : "bad"}"></span><b>${esc(e.provider)}</b></span></td>
        <td class="num">${fmt(e.in)}</td><td class="num">${fmt(e.cache)}${e.cache_est ? ' <span class="mini">≈</span>' : ""}</td>
        <td class="num">${fmt(e.out)}</td><td class="num"><span class="pnum">${fmt(e.blended)}</span></td>
        <td class="num">${e.discount ? (e.discount * 100).toFixed(0) + "%" : "—"}</td>
        <td class="num"><span class="tps">${e.tps ? e.tps.toFixed(0) : "n/a"}<span class="tbar"><span style="width:${barW}%;background:${barColor}"></span></span></span></td>
        <td class="num">${e.uptime ? e.uptime.toFixed(1) + "%" : "n/a"}</td>
        <td><span class="badge ${e.healthy ? "ok" : "bad"}">${e.healthy ? "healthy" : "off"}</span></td>
        <td><button class="sm primary" data-m="${esc(slug)}" data-p="${esc(e.provider)}">use</button></td></tr>`;
    }).join("");
    $$("#ep-rows button[data-m]").forEach(b => b.onclick = () => applyChoice(b.dataset.m, b.dataset.p));
  } catch (e) { toast(e.message, true); }
}

async function applyChoice(model, provider) {
  try {
    const r = await api("/api/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, provider }) });
    toast(`Applied: ${r.model} @ ${r.provider} (${r.gateway})`);
    await loadCommon();
  } catch (e) { toast(e.message, true); }
}

/* ---------------------------------------------------------------- chains */

function viewChains() {
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Fallback chains</h1><div class="sub">Ordered pipelines. The primary chain drives your config; the engine walks it top → bottom and uses the first healthy step.</div></div>
      <button class="primary" id="btn-newchain">+ New chain</button>
    </div>
    <div id="chains-list"></div>`;
  renderChains();
  $("#btn-newchain").onclick = async () => {
    const name = prompt("Chain name:");
    if (!name) return;
    try {
      await api("/api/chains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, entries: [] }) });
      toast("Chain created: " + name);
      CHAINS = (await api("/api/chains")).chains;
      renderChains();
    } catch (e) { toast(e.message, true); }
  };
}

function renderChains() {
  $("#chains-list").innerHTML = CHAINS.map((c, ci) => `
    <div class="panel">
      <h2>${esc(c.name)} ${c.primary ? '<span class="badge ok">PRIMARY</span>' : ""} ${c.auto_apply ? '<span class="badge info">auto-apply</span>' : '<span class="badge warn">manual</span>'}</h2>
      <div class="chain-flow">${c.entries.length ? c.entries.map((e, i) => {
        const m = e.type === "cheapest" ? "cheapest in watchlist" : esc(e.model);
        const p = e.type === "cheapest" ? "auto" : esc(e.provider || "auto");
        return `<div class="chain-node"><div class="t">#${i + 1}</div><div class="m">${m}</div><div class="p">@ ${p}</div></div>` +
          (i < c.entries.length - 1 ? '<span class="chain-arrow">→</span>' : "");
      }).join("") : '<span class="empty">No entries yet — add one below.</span>'}</div>
      <div style="margin-top:10px">${c.entries.map((e, i) => `
        <div class="chain-entry-row">
          <span class="idx">${i + 1}</span>
          <span class="grow mono" style="font-size:12.5px">${e.type === "cheapest" ? "★ cheapest in watchlist" : esc(e.model) + " @ " + esc(e.provider || "auto")}</span>
          <button class="sm" data-act="up" data-ci="${ci}" data-ei="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="sm" data-act="down" data-ci="${ci}" data-ei="${i}" ${i === c.entries.length - 1 ? "disabled" : ""}>↓</button>
          <button class="sm danger" data-act="del" data-ci="${ci}" data-ei="${i}">✕</button>
        </div>`).join("")}</div>
      <div class="row-ctl" style="margin-top:12px">
        <div><label class="field">Add step — model</label>
          <div class="autocomplete"><input id="ac-${ci}" placeholder="search models…">
            <div class="ac-list" id="acl-${ci}"></div></div></div>
        <div style="max-width:170px"><label class="field">Provider</label>
          <select id="prov-${ci}"><option value="auto">auto (cheapest healthy)</option></select></div>
        <div style="max-width:150px;align-self:end"><button id="add-${ci}">+ Add step</button></div>
        <div style="max-width:150px;align-self:end"><button id="cheap-${ci}">+ Cheapest</button></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <label class="switch"><input type="checkbox" id="aa-${ci}" ${c.auto_apply ? "checked" : ""}> auto-apply</label>
        <button class="sm" data-act="primary" data-ci="${ci}" ${c.primary ? "disabled" : ""}>Set as primary</button>
        <button class="sm danger" data-act="delchain" data-ci="${ci}">Delete chain</button>
      </div>
    </div>`).join("");

  $$("#chains-list [data-act]").forEach(b => b.onclick = () => chainAction(b.dataset));

  CHAINS.forEach((c, ci) => {
    const input = $("#ac-" + ci), list = $("#acl-" + ci), sel = $("#prov-" + ci);
    let deb;
    input.oninput = () => {
      clearTimeout(deb);
      deb = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) { list.classList.remove("show"); return; }
        const r = await api("/api/catalog?q=" + encodeURIComponent(q));
        list.innerHTML = r.results.map(m =>
          `<div class="ac-item" data-slug="${esc(m.id)}"><span class="n">${esc(m.id)}</span><div class="d">${esc(m.name || "")}</div></div>`).join("")
          || '<div class="ac-item faint">no match</div>';
        list.classList.add("show");
        $$(".ac-item[data-slug]", list).forEach(it => it.onclick = () => {
          input.value = it.dataset.slug;
          fillProviders(ci, it.dataset.slug);
          list.classList.remove("show");
        });
      }, 250);
    };
    $("#add-" + ci).onclick = async () => {
      const slug = input.value.trim();
      if (!slug) { toast("Pick a model first", true); return; }
      const e = { type: "model", model: slug, provider: sel.value };
      c.entries.push(e);
      await saveChain(c);
      toast("Step added");
    };
    $("#cheap-" + ci).onclick = async () => {
      c.entries.push({ type: "cheapest" });
      await saveChain(c);
    };
    $("#aa-" + ci).onchange = async ev => {
      c.auto_apply = ev.target.checked;
      await api("/api/chains/" + encodeURIComponent(c.name), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
      CHAINS = (await api("/api/chains")).chains;
      renderChains();
    };
  });
}

async function fillProviders(ci, slug) {
  const sel = $("#prov-" + ci);
  sel.innerHTML = '<option value="auto">auto (cheapest healthy)</option>';
  try {
    const d = await api("/api/endpoints/" + encodeURIComponent(slug));
    d.endpoints.forEach(e => {
      if (e.error) return;
      sel.insertAdjacentHTML("beforeend", `<option value="${esc(e.provider)}">${esc(e.provider)} — ${fmt(e.blended)} $/M</option>`);
    });
  } catch (err) {}
}

async function saveChain(c) {
  await api("/api/chains/" + encodeURIComponent(c.name), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
  CHAINS = (await api("/api/chains")).chains;
  renderChains();
}

async function chainAction(d) {
  const c = CHAINS[+d.ci];
  if (d.act === "del") {
    c.entries.splice(+d.ei, 1);
    await saveChain(c);
  } else if (d.act === "up") {
    [c.entries[+d.ei - 1], c.entries[+d.ei]] = [c.entries[+d.ei], c.entries[+d.ei - 1]];
    await saveChain(c);
  } else if (d.act === "down") {
    [c.entries[+d.ei + 1], c.entries[+d.ei]] = [c.entries[+d.ei], c.entries[+d.ei + 1]];
    await saveChain(c);
  } else if (d.act === "primary") {
    await api("/api/chains/" + encodeURIComponent(c.name) + "/primary", { method: "POST" });
    CHAINS = (await api("/api/chains")).chains;
    renderChains();
    toast(c.name + " is now the primary chain");
  } else if (d.act === "delchain") {
    try {
      await api("/api/chains/" + encodeURIComponent(c.name), { method: "DELETE" });
      CHAINS = (await api("/api/chains")).chains;
      renderChains();
    } catch (e) { toast(e.message, true); }
  }
}

/* -------------------------------------------------------------- API page */

async function viewApi() {
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>API endpoint</h1>
      <div class="sub">OpenAI-compatible. Point any client (openai SDK, LangChain, curl) at PennyRoute and it routes through your chains.</div></div></div>
    <div class="panel"><h2>Base URL</h2>
      <div class="row-ctl">
        <div><label class="field">On this machine</label><input readonly value="http://localhost:8490/v1" id="url-local"></div>
        <div><label class="field">From LAN / Tailscale</label><input readonly value="http://YOUR-IP:8490/v1" id="url-lan"></div>
        <div style="max-width:120px;align-self:end"><button id="btn-copy-url">Copy LAN</button></div>
      </div>
      <div class="hint" style="margin-top:8px">Reachable on all interfaces (0.0.0.0). From another device use the Tailscale IP or LAN IP of this machine — same port.</div>
    </div>
    <div class="panel"><h2>Routing now</h2><div id="resolve-box"><span class="spinner"></span></div></div>
    <div class="panel"><h2>API keys</h2>
      <div class="row-ctl" style="max-width:520px">
        <div><label class="field">Key name</label><input id="key-name" placeholder="e.g. my-laptop"></div>
        <div style="max-width:130px;align-self:end"><button class="primary" id="btn-newkey">Create key</button></div>
      </div>
      <div id="newkey-box" style="display:none;margin-top:12px">
        <div class="hint" style="margin-bottom:6px">Copy it now — it will not be shown again.</div>
        <div class="row-ctl"><div><input readonly id="newkey-val" class="mono"></div>
        <div style="max-width:120px;align-self:end"><button id="btn-copy-key">Copy</button></div></div>
      </div>
      <div id="keys-list" style="margin-top:14px"></div>
    </div>
    <div class="panel"><h2>Usage</h2>
      <div class="hint" style="margin-bottom:8px">model field: <span class="mono">"penny"</span> = primary chain · <span class="mono">"penny:free-first"</span> = a named chain · any real model id = that model, routed to its cheapest healthy provider.</div>
      <label class="field">curl</label>
      <pre class="mono" id="ex-curl" style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;overflow:auto"></pre>
      <label class="field">Python (openai SDK)</label>
      <pre class="mono" id="ex-py" style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;overflow:auto"></pre>
    </div>`;

  const host = location.host || "localhost:8490";
  $("#url-local").value = "http://" + host + "/v1";
  $("#url-lan").value = "http://" + host.split(":")[0] + ":8490/v1   (replace with Tailscale/LAN IP of this machine)";
  $("#btn-copy-url").onclick = () => { navigator.clipboard.writeText("http://" + host.split(":")[0] + ":8490/v1"); toast("Base URL copied"); };

  try {
    const r = await api("/api/resolve");
    const res = r.resolution;
    $("#resolve-box").innerHTML = res
      ? `<div class="pill ok"><span class="dot"></span> ${esc(res.model)} @ ${esc(res.provider)} — ${fmt(res.blended)} $/M blended</div>
         <div class="hint" style="margin-top:6px">Reason: ${esc(res.reason)} · via chain "${esc(res.model && r.resolution ? '' : '')}"</div>`
      : '<span class="badge warn">no healthy resolution</span>';
  } catch (e) { $("#resolve-box").innerHTML = '<span class="badge bad">resolve failed</span>'; }

  const loadKeys = async () => {
    const d = await api("/api/keys");
    $("#keys-list").innerHTML = d.keys.length ? `<table><thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>` +
      d.keys.map(k => `<tr><td><b>${esc(k.name)}</b></td><td class="mono">${esc(k.prefix)}…</td><td class="mini">${esc(k.created)}</td><td class="mini">${esc(k.last_used || "never")}</td>
        <td><button class="sm danger" data-id="${esc(k.id)}">revoke</button></td></tr>`).join("") + "</tbody></table>"
      : '<div class="empty">No keys yet — create one.</div>';
    $$("#keys-list button[data-id]").forEach(b => b.onclick = async () => {
      await api("/api/keys/" + b.dataset.id, { method: "DELETE" });
      toast("Key revoked");
      loadKeys();
    });
  };
  await loadKeys();

  $("#btn-newkey").onclick = async () => {
    try {
      const r = await api("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: $("#key-name").value || "default" }) });
      $("#newkey-box").style.display = "";
      $("#newkey-val").value = r.key;
      $("#btn-copy-key").onclick = () => { navigator.clipboard.writeText(r.key); toast("Key copied"); };
      loadKeys();
    } catch (e) { toast(e.message, true); }
  };

  const base = "http://" + host + "/v1";
  $("#ex-curl").textContent = `curl ${base}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: pnk-YOUR-KEY" \\
  -d '{
    "model": "penny",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": false
  }'`;
  $("#ex-py").textContent = `from openai import OpenAI

client = OpenAI(base_url="${base}", api_key="pnk-YOUR-KEY")

r = client.chat.completions.create(
    model="penny",   # primary chain; or "penny:free-first", or a model id
    messages=[{"role": "user", "content": "hello"}],
)
print(r.model)  # resolved model id; response also carries .pennyroute.served_by`;
}

/* ------------------------------------------------------------------ chat */

function viewChat() {
  const savedKey = localStorage.getItem("penny_key") || "";
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>Chat</h1>
      <div class="sub">Talk to the router from any device on Tailscale / LAN. Key stays in this browser (localStorage), never on the server.</div></div></div>
    <div class="panel" style="padding:14px 18px">
      <div class="row-ctl">
        <div><label class="field">PennyRoute API key</label>
          <input type="password" id="chat-key" placeholder="pnk-…" value="${esc(savedKey)}" class="mono"></div>
        <div style="max-width:260px"><label class="field">Route</label>
          <select id="chat-model">
            <option value="penny">penny — primary chain</option>
            ${CHAINS.filter(c => !c.primary).map(c => `<option value="penny:${esc(c.name)}">penny:${esc(c.name)}</option>`).join("")}
            <option value="__ids__">— specific model —</option>
          </select></div>
        <div style="max-width:300px" id="chat-model-wrap" style="display:none"><label class="field">Model</label>
          <select id="chat-model-id"></select></div>
      </div>
      <div class="hint" style="margin-top:6px">Create keys in <a href="#/api" style="color:var(--accent)">API endpoint</a>.</div>
    </div>
    <div class="panel" style="padding:0">
      <div id="chat-log" style="padding:16px 18px;min-height:280px;max-height:60vh;overflow:auto"></div>
      <div style="border-top:1px solid var(--border);padding:12px 16px;display:flex;gap:10px">
        <input id="chat-input" placeholder="Scrivi un messaggio… (Enter per inviare)" autocomplete="off">
        <button class="primary" id="chat-send" style="flex:none">Send</button>
      </div>
    </div>
    <div class="panel" id="chat-meta" style="display:none"></div>`;

  const log = $("#chat-log");
  const input = $("#chat-input");
  const modelSel = $("#chat-model"), modelIdSel = $("#chat-model-id"), wrap = $("#chat-model-wrap");
  let history = [];

  modelSel.onchange = async () => {
    if (modelSel.value === "__ids__") {
      wrap.style.display = "";
      modelIdSel.innerHTML = '<option>loading…</option>';
      try {
        const key = $("#chat-key").value.trim();
        const d = await fetch("/v1/models", { headers: { "X-API-Key": key } }).then(r => r.json());
        modelIdSel.innerHTML = (d.data || []).map(m => `<option value="${esc(m.id)}">${esc(m.id)}${m.owned_by === "pennyroute-primary" ? " ★primary" : ""}</option>`).join("");
      } catch (e) { modelIdSel.innerHTML = '<option value="penny">penny</option>'; }
    } else wrap.style.display = "none";
  };

  const bubble = (role, text, meta) => {
    const el = document.createElement("div");
    el.style.cssText = "margin:10px 0;display:flex;" + (role === "user" ? "justify-content:flex-end" : "justify-content:flex-start");
    const b = document.createElement("div");
    b.style.cssText = `max-width:78%;border-radius:12px;padding:10px 14px;font-size:13.5px;white-space:pre-wrap;
      background:${role === "user" ? "var(--accent-dim)" : "var(--surface2)"};border:1px solid var(--border2)`;
    b.textContent = text;
    el.appendChild(b);
    if (meta) {
      const m = document.createElement("div");
      m.style.cssText = "font-size:10.5px;color:var(--faint);margin-top:4px;font-family:var(--mono)";
      m.textContent = meta;
      el.appendChild(m);
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return b;
  };

  const send = async () => {
    const key = $("#chat-key").value.trim();
    if (!key) { toast("Insert your API key first", true); return; }
    localStorage.setItem("penny_key", key);
    const text = input.value.trim();
    if (!text) return;
    const model = modelSel.value === "__ids__" ? modelIdSel.value : modelSel.value;
    input.value = "";
    bubble("user", text);
    history.push({ role: "user", content: text });
    const btn = $("#chat-send"); btn.disabled = true;
    const thinking = bubble("assistant", "…");
    try {
      const r = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": key },
        body: JSON.stringify({ model, messages: history, max_tokens: 2048 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || r.status);
      const content = d.choices?.[0]?.message?.content || "(empty)";
      thinking.textContent = content;
      history.push({ role: "assistant", content });
      const sb = d.pennyroute?.served_by;
      $("#chat-meta").style.display = "";
      $("#chat-meta").innerHTML = `<span class="pill ok"><span class="dot"></span> served by ${esc(sb || d.model || "?")}</span>`;
    } catch (e) {
      thinking.textContent = "Error: " + e.message;
      thinking.style.color = "var(--red)";
    }
    btn.disabled = false;
    input.focus();
  };
  $("#chat-send").onclick = send;
  input.onkeydown = ev => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } };
}

/* ---------------------------------------------------------------- models */

function viewModels() {
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Watchlist</h1><div class="sub">Models ranked by the engine. Add any OpenRouter model — the ranking covers its providers.</div></div>
    </div>
    <div class="panel"><h2>Add model</h2>
      <div class="autocomplete" style="max-width:520px">
        <input id="model-search" placeholder="Type to search 468+ models (e.g. kimi, glm, deepseek)…">
        <div class="ac-list" id="model-ac"></div>
      </div></div>
    <div class="panel"><h2>${MODELS.length} models</h2>
      <table><thead><tr><th>Slug</th><th>Note</th><th></th></tr></thead>
      <tbody>${MODELS.map(m => `<tr><td class="mono">${esc(m.slug)}</td><td class="muted">${esc(m.note || "")}</td>
        <td><button class="sm danger" data-slug="${esc(m.slug)}">remove</button></td></tr>`).join("")}</tbody></table></div>`;
  $$("#view button[data-slug]").forEach(b => b.onclick = async () => {
    await api("/api/models/" + encodeURIComponent(b.dataset.slug), { method: "DELETE" });
    MODELS = (await api("/api/models")).models;
    toast("Removed from watchlist");
    viewModels();
  });
  const input = $("#model-search"), list = $("#model-ac");
  let deb;
  input.oninput = () => {
    clearTimeout(deb);
    deb = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { list.classList.remove("show"); return; }
      const r = await api("/api/catalog?q=" + encodeURIComponent(q));
      list.innerHTML = r.results.map(m =>
        `<div class="ac-item" data-slug="${esc(m.id)}"><span class="n">${esc(m.id)}</span><div class="d">${esc(m.name || "")}</div></div>`).join("")
        || '<div class="ac-item faint">no match</div>';
      list.classList.add("show");
      $$(".ac-item", list).forEach(it => it.onclick = async () => {
        list.classList.remove("show");
        input.value = "";
        try {
          await api("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: it.dataset.slug }) });
          MODELS = (await api("/api/models")).models;
          toast("Added: " + it.dataset.slug);
          viewModels();
        } catch (e) { toast(e.message, true); }
      });
    }, 300);
  };
}

/* -------------------------------------------------------------- settings */

function viewSettings() {
  const s = STATE.settings;
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="sub">Engine behaviour. Applied live — no restart needed.</div></div></div>
    <div class="panel"><h2>Cost model</h2>
      <div class="hint" style="margin-bottom:6px">Blended $/M = in_f · input + cache_f · cache + out_f · output. Defaults from your measured month: 14 / 85 / 1.</div>
      ${mixControls("s")}
    </div>
    <div class="panel"><h2>Health gates</h2>
      <div class="row-ctl">
        <div><label class="field">Min throughput (tps)</label><input type="number" id="s-tps" value="${s.min_tps}"></div>
        <div><label class="field">Min uptime (%)</label><input type="number" id="s-up" value="${s.min_uptime}" step="0.1"></div>
        <div><label class="field">Check interval (min)</label><input type="number" id="s-int" value="${s.interval_min}"></div>
      </div></div>
    <div class="panel"><h2>Applying</h2>
      <label class="switch"><input type="checkbox" id="s-restart" ${s.gateway_restart ? "checked" : ""}> Restart gateway after switching (required for the new pin to take effect)</label>
      <div style="margin-top:14px"><button class="primary" id="btn-save">Save settings</button></div></div>`;
  ["in", "cache", "out"].forEach(k => $("#s-" + k).value = Math.round(STATE.settings.mix[k] * 100));
  $("#btn-save").onclick = async () => {
    try {
      const body = {
        mix: { in: +$("#s-in").value / 100, cache: +$("#s-cache").value / 100, out: +$("#s-out").value / 100 },
        min_tps: +$("#s-tps").value, min_uptime: +$("#s-up").value,
        interval_min: +$("#s-int").value, gateway_restart: $("#s-restart").checked,
      };
      const r = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      STATE.settings = r.settings;
      toast("Settings saved");
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------------------------------------------------------------- events */

function viewEvents() {
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>Events</h1><div class="sub">Engine decisions and switches.</div></div></div>
    <div class="panel"><div id="ev-list"><span class="spinner"></span></div></div>`;
  api("/api/events?limit=60").then(d => {
    $("#ev-list").innerHTML = d.events.length ? d.events.map(e => `
      <div class="ev-row"><span class="ts">${esc(e.ts)}</span>
        <span class="badge ${e.event === "switch" ? "ok" : e.event === "engine_error" ? "bad" : "info"}">${esc(e.event)}</span>
        <span class="body">${esc(JSON.stringify({ ...e, ts: undefined, event: undefined }, null, 0).slice(1, -1))}</span>
      </div>`).join("") : '<div class="empty">No events yet.</div>';
  });
}

/* ---------------------------------------------------------------- router */

const VIEWS = { overview: viewOverview, ranking: viewRanking, chains: viewChains, api: viewApi, chat: viewChat, models: viewModels, settings: viewSettings, events: viewEvents };

function route() {
  const name = (location.hash.replace("#/", "") || "overview");
  const view = VIEWS[name] ? name : "overview";
  $$("#nav .nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  VIEWS[view]();
}

async function loadCommon() {
  const [st, ch, md] = await Promise.all([api("/api/state"), api("/api/chains"), api("/api/models")]);
  STATE = st; CHAINS = ch.chains; MODELS = md.models;
  RANKED = (await api("/api/rank")).models;
  route();
}

window.addEventListener("hashchange", route);
window.addEventListener("load", async () => {
  buildNav();
  try {
    await loadCommon();
  } catch (e) {
    $("#view").innerHTML = `<div class="panel"><h2>Backend offline</h2><div class="muted">${esc(e.message)}</div></div>`;
  }
  setInterval(async () => {
    try { STATE = await api("/api/state"); } catch (e) {}
  }, 30000);
});
