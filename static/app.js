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
  models: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  events: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2.5 2.5"/></svg>',
};

const NAV = [
  ["overview", "Overview", ICONS.overview],
  ["ranking", "Ranking", ICONS.ranking],
  ["chains", "Fallback chains", ICONS.chains],
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

function viewOverview() {
  const a = STATE.active;
  const order = (a.order && a.order.length) ? a.order.join(", ") : "auto";
  const primary = CHAINS.find(c => c.name === STATE.primary_chain);
  let chainHtml = '<div class="empty">No primary chain</div>';
  if (primary) {
    chainHtml = '<div class="chain-flow">' + primary.entries.map((e, i) => {
      const m = e.type === "cheapest" ? "cheapest in watchlist" : esc(e.model);
      const p = e.type === "cheapest" ? "auto" : esc(e.provider || "auto");
      return `<div class="chain-node"><div class="t">#${i + 1}</div><div class="m">${m}</div><div class="p">@ ${p}</div></div>` +
        (i < primary.entries.length - 1 ? '<span class="chain-arrow">→</span>' : "");
    }).join("") + "</div>";
  }
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Overview</h1><div class="sub">What is running right now, and what will run if this one fails.</div></div>
      <button class="primary" id="btn-evaluate">Evaluate now</button>
    </div>
    <div class="grid3">
      <div class="stat"><div class="label">Active model</div><div class="value" style="font-size:14px;font-family:var(--mono)">${esc(a.model || "—")}</div><div class="sub">@ ${esc(order)}</div></div>
      <div class="stat"><div class="label">Primary chain</div><div class="value" style="font-size:14px">${esc(STATE.primary_chain || "—")}</div><div class="sub">${primary ? primary.entries.length + " fallback step(s)" : "configure one in Chains"}</div></div>
      <div class="stat"><div class="label">Watchlist</div><div class="value">${MODELS.length}</div><div class="sub">models ranked every ${STATE.settings.interval_min} min</div></div>
    </div>
    <div class="card"><h2>Fallback pipeline — ${esc(STATE.primary_chain || "none")}</h2>${chainHtml}
      <div class="hint">The engine walks this chain top → bottom. First healthy step wins; switches are applied to <span class="mono">~/.hermes/config.yaml</span> automatically.</div></div>
    <div class="card"><h2>Top 5 cheapest (blended, your mix)</h2>
      <table><thead><tr><th>#</th><th>Model</th><th>Provider</th><th class="num">Blended $/M</th><th class="num">tps</th></tr></thead>
      <tbody>${RANKED.slice(0, 5).map((m, i) => {
        const b = m.best; if (!b) return "";
        return `<tr><td>${i + 1}</td><td><span class="model-name mono">${esc(m.slug)}</span></td><td>${esc(b.provider)}</td><td class="num">${fmt(b.blended)}</td><td class="num">${b.tps ? b.tps.toFixed(0) : "n/a"}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  $("#btn-evaluate").onclick = async () => {
    toast("Evaluating chain…");
    try { const r = await api("/api/evaluate", { method: "POST" });
      toast(r.ok ? `OK: ${r.resolution ? r.resolution.model + " @ " + r.resolution.provider : "no healthy step"}` : "Failed: " + r.reason, !r.ok);
      await loadCommon();
    } catch (e) { toast(e.message, true); }
  };
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
      <div><button id="btn-refresh">↻ Refresh</button></div>
    </div>
    <div class="card"><h2>Token mix</h2>${mixControls("mix")}</div>
    <div class="card"><table><thead><tr>
      <th>#</th><th>Model</th><th>Best provider</th><th class="num">in</th><th class="num">cache</th><th class="num">out</th><th class="num">Blended $/M</th><th class="num">tps</th><th class="num">uptime</th><th></th>
    </tr></thead><tbody id="rank-rows"></tbody></table></div>
    <div class="card" id="detail-card" style="display:none"><h2>Providers — <span class="mono" id="detail-slug"></span></h2>
      <table><thead><tr><th>#</th><th>Provider</th><th class="num">in</th><th class="num">cache</th><th class="num">out</th><th class="num">Blended</th><th class="num">discount</th><th class="num">tps</th><th class="num">uptime</th><th></th><th></th></tr></thead>
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
    if (m.error) return `<tr><td>${i + 1}</td><td colspan="9" style="color:var(--red)">${esc(m.slug)}: ${esc(m.error)}</td></tr>`;
    if (!b) return `<tr><td>${i + 1}</td><td><span class="model-name mono">${esc(m.slug)}</span></td><td colspan="8" class="faint">no endpoints</td></tr>`;
    const hc = m.healthy_count, pc = m.provider_count;
    const cls = hc === pc ? "ok" : hc > 0 ? "warn" : "bad";
    return `<tr class="${m.slug === cur ? "active-row" : ""}">
      <td>${i + 1}</td>
      <td><div class="model-name mono">${esc(m.slug)}</div><div class="model-sub">${esc(m.note || "")}</div></td>
      <td>${esc(b.provider)}${b.cache_est ? ' <span class="mini">≈</span>' : ""}</td>
      <td class="num">${fmt(b.in)}</td><td class="num">${fmt(b.cache)}</td><td class="num">${fmt(b.out)}</td>
      <td class="num"><b>${fmt(b.blended)}</b></td>
      <td class="num">${b.tps ? b.tps.toFixed(0) : "n/a"}</td>
      <td class="num">${b.uptime ? b.uptime.toFixed(1) + "%" : "n/a"}</td>
      <td><span class="badge ${cls}">${hc}/${pc}</span> <button class="sm" data-slug="${esc(m.slug)}">providers</button></td>
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
      return `<tr>
        <td>${i + 1}</td><td><b>${esc(e.provider)}</b></td>
        <td class="num">${fmt(e.in)}</td><td class="num">${fmt(e.cache)}${e.cache_est ? ' <span class="mini">≈</span>' : ""}</td>
        <td class="num">${fmt(e.out)}</td><td class="num"><b>${fmt(e.blended)}</b></td>
        <td class="num">${e.discount ? (e.discount * 100).toFixed(0) + "%" : "—"}</td>
        <td class="num">${e.tps ? e.tps.toFixed(0) : "n/a"}</td>
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
    <div class="card">
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

/* ---------------------------------------------------------------- models */

function viewModels() {
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Watchlist</h1><div class="sub">Models ranked by the engine. Add any OpenRouter model — the ranking covers its providers.</div></div>
    </div>
    <div class="card"><h2>Add model</h2>
      <div class="autocomplete" style="max-width:520px">
        <input id="model-search" placeholder="Type to search 468+ models (e.g. kimi, glm, deepseek)…">
        <div class="ac-list" id="model-ac"></div>
      </div></div>
    <div class="card"><h2>${MODELS.length} models</h2>
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
    <div class="card"><h2>Cost model</h2>
      <div class="hint" style="margin-bottom:6px">Blended $/M = in_f · input + cache_f · cache + out_f · output. Defaults from your measured month: 14 / 85 / 1.</div>
      ${mixControls("s")}
    </div>
    <div class="card"><h2>Health gates</h2>
      <div class="row-ctl">
        <div><label class="field">Min throughput (tps)</label><input type="number" id="s-tps" value="${s.min_tps}"></div>
        <div><label class="field">Min uptime (%)</label><input type="number" id="s-up" value="${s.min_uptime}" step="0.1"></div>
        <div><label class="field">Check interval (min)</label><input type="number" id="s-int" value="${s.interval_min}"></div>
      </div></div>
    <div class="card"><h2>Applying</h2>
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
    <div class="card"><div id="ev-list"><span class="spinner"></span></div></div>`;
  api("/api/events?limit=60").then(d => {
    $("#ev-list").innerHTML = d.events.length ? d.events.map(e => `
      <div class="ev-row"><span class="ts">${esc(e.ts)}</span>
        <span class="badge ${e.event === "switch" ? "ok" : e.event === "engine_error" ? "bad" : "info"}">${esc(e.event)}</span>
        <span class="body">${esc(JSON.stringify({ ...e, ts: undefined, event: undefined }, null, 0).slice(1, -1))}</span>
      </div>`).join("") : '<div class="empty">No events yet.</div>';
  });
}

/* ---------------------------------------------------------------- router */

const VIEWS = { overview: viewOverview, ranking: viewRanking, chains: viewChains, models: viewModels, settings: viewSettings, events: viewEvents };

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
    $("#view").innerHTML = `<div class="card"><h2>Backend offline</h2><div class="muted">${esc(e.message)}</div></div>`;
  }
  setInterval(async () => {
    try { STATE = await api("/api/state"); } catch (e) {}
  }, 30000);
});
