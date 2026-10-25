"""PennyRoute — FastAPI app.

Run:  uvicorn pennyroute.app:app --host 0.0.0.0 --port 8490
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import engine
from . import keys
from . import orclient
from . import ranking
from . import router_proxy
from . import store

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="PennyRoute", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    engine.start()


def _require_key(request: Request):
    raw = request.headers.get("x-api-key") or request.headers.get("authorization")
    if not keys.verify_key(raw):
        raise HTTPException(401, "invalid or missing API key")


# ------------------------------------------------------------- /v1 (router) --

@app.post("/v1/chat/completions")
async def v1_chat(request: Request):
    _require_key(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "JSON body required")
    return await router_proxy.proxy_chat(request, body)


@app.get("/v1/models")
def v1_models(request: Request):
    _require_key(request)
    # what the primary chain would serve right now
    settings = store.load_settings()
    ranked = ranking.rank_models(store.load_models(), settings["mix"],
                                 {"min_tps": settings["min_tps"],
                                  "min_uptime": settings["min_uptime"]})
    chains = store.load_chains()
    primary = next((c for c in chains if c.get("primary")), None)
    res = ranking.resolve_chain(primary, ranked, settings["mix"],
                                {"min_tps": settings["min_tps"],
                                 "min_uptime": settings["min_uptime"]}) if primary else None
    served = res["model"] if res else None
    data = [{"id": m["slug"], "object": "model",
             "owned_by": "pennyroute"} for m in store.load_models()]
    if served:
        data.insert(0, {"id": served, "object": "model", "owned_by": "pennyroute-primary"})
    return {"object": "list", "data": data}


# ---------------------------------------------------------------- state ----

@app.get("/api/state")
def api_state():
    settings = store.load_settings()
    chains = store.load_chains()
    primary = next((c for c in chains if c.get("primary")), None)
    return {
        "active": engine.current_active(),
        "primary_chain": primary["name"] if primary else None,
        "settings": settings,
        "model_count": len(store.load_models()),
    }


# --------------------------------------------------------------- ranking ---

@app.get("/api/rank")
def api_rank(force: bool = False):
    settings = store.load_settings()
    ranked = ranking.rank_models(store.load_models(), settings["mix"],
                                 {"min_tps": settings["min_tps"],
                                  "min_uptime": settings["min_uptime"]},
                                 force=force)
    return {"models": ranked, "mix": settings["mix"]}


@app.get("/api/endpoints/{slug:path}")
def api_endpoints(slug: str, force: bool = False):
    settings = store.load_settings()
    rows = ranking.rank_endpoints(slug, settings["mix"],
                                  {"min_tps": settings["min_tps"],
                                   "min_uptime": settings["min_uptime"]},
                                  force=force)
    return {"slug": slug, "mix": settings["mix"], "endpoints": rows}


@app.get("/api/catalog")
def api_catalog(q: str = ""):
    return {"results": orclient.search_catalog(q)}


# ---------------------------------------------------------------- models ---

class ModelIn(BaseModel):
    slug: str
    note: str = ""


@app.get("/api/models")
def api_models():
    return {"models": store.load_models()}


@app.post("/api/models")
def api_add_model(m: ModelIn):
    slug = m.slug.strip()
    if not slug:
        raise HTTPException(400, "empty slug")
    if not store.add_model(slug, m.note):
        raise HTTPException(409, "already in watchlist")
    return {"ok": True}


@app.delete("/api/models/{slug:path}")
def api_del_model(slug: str):
    if not store.remove_model(slug):
        raise HTTPException(404, "not in watchlist")
    return {"ok": True}


# ---------------------------------------------------------------- chains ---

class ChainIn(BaseModel):
    name: str
    auto_apply: bool = True
    entries: list[dict] = []


@app.get("/api/chains")
def api_chains():
    return {"chains": store.load_chains()}


def _validate_chain(chain: dict):
    for e in chain.get("entries") or []:
        if e.get("type") == "model" and not e.get("model"):
            raise HTTPException(400, "model entry without slug")
        if e.get("type") not in ("model", "cheapest"):
            raise HTTPException(400, "unknown entry type")


@app.post("/api/chains")
def api_add_chain(c: ChainIn):
    chains = store.load_chains()
    if any(x["name"] == c.name for x in chains):
        raise HTTPException(409, "chain name exists")
    chain = {"name": c.name, "primary": False, "auto_apply": c.auto_apply,
             "entries": c.entries}
    _validate_chain(chain)
    chains.append(chain)
    store.save_chains(chains)
    return {"ok": True}


@app.put("/api/chains/{name}")
def api_update_chain(name: str, c: ChainIn):
    chains = store.load_chains()
    for i, x in enumerate(chains):
        if x["name"] == name:
            chain = {"name": name, "primary": x.get("primary", False),
                     "auto_apply": c.auto_apply, "entries": c.entries}
            _validate_chain(chain)
            chains[i] = chain
            store.save_chains(chains)
            return {"ok": True}
    raise HTTPException(404, "chain not found")


@app.post("/api/chains/{name}/primary")
def api_set_primary(name: str):
    chains = store.load_chains()
    if not any(x["name"] == name for x in chains):
        raise HTTPException(404, "chain not found")
    for x in chains:
        x["primary"] = (x["name"] == name)
    store.save_chains(chains)
    store.log_event("primary", {"chain": name})
    return {"ok": True}


@app.delete("/api/chains/{name}")
def api_del_chain(name: str):
    chains = store.load_chains()
    primary = next((x for x in chains if x["name"] == name), None)
    if primary and primary.get("primary") and len(chains) > 1:
        raise HTTPException(400, "set another chain primary first")
    store.save_chains([x for x in chains if x["name"] != name])
    return {"ok": True}


# --------------------------------------------------------------- apply ----

class ApplyIn(BaseModel):
    model: str
    provider: str


@app.post("/api/apply")
def api_apply(a: ApplyIn):
    settings = store.load_settings()
    res = engine.apply_choice(a.model, a.provider,
                              restart=settings.get("gateway_restart", True))
    return {"ok": True, **res}


@app.post("/api/evaluate")
def api_evaluate():
    return engine.evaluate_primary()


# ------------------------------------------------------------- settings ---

class SettingsIn(BaseModel):
    mix: dict | None = None
    min_tps: float | None = None
    min_uptime: float | None = None
    interval_min: int | None = None
    gateway_restart: bool | None = None


@app.get("/api/settings")
def api_settings():
    return store.load_settings()


@app.put("/api/settings")
def api_set_settings(s: SettingsIn):
    cur = store.load_settings()
    if s.mix:
        cur["mix"] = s.mix
    for k in ("min_tps", "min_uptime", "interval_min", "gateway_restart"):
        if getattr(s, k) is not None:
            cur[k] = getattr(s, k)
    store.save_settings(cur)
    return {"ok": True, "settings": cur}


# --------------------------------------------------------------- events ---

@app.get("/api/events")
def api_events(limit: int = 60):
    return {"events": store.load_events(limit)}


# ----------------------------------------------------------------- keys ---

class KeyIn(BaseModel):
    name: str = "default"


@app.get("/api/keys")
def api_keys():
    return {"keys": keys.list_keys()}


@app.post("/api/keys")
def api_create_key(k: KeyIn):
    res = keys.create_key(k.name)
    if not res:
        raise HTTPException(500, "could not create key")
    return res


@app.delete("/api/keys/{key_id}")
def api_revoke_key(key_id: str):
    if not keys.revoke_key(key_id):
        raise HTTPException(404, "key not found")
    return {"ok": True}


@app.get("/api/resolve")
def api_resolve():
    """What the primary chain would serve right now (for the API page)."""
    settings = store.load_settings()
    ranked = ranking.rank_models(store.load_models(), settings["mix"],
                                 {"min_tps": settings["min_tps"],
                                  "min_uptime": settings["min_uptime"]})
    chains = store.load_chains()
    primary = next((c for c in chains if c.get("primary")), None)
    res = ranking.resolve_chain(primary, ranked, settings["mix"],
                                {"min_tps": settings["min_tps"],
                                 "min_uptime": settings["min_uptime"]}) if primary else None
    return {"resolution": res, "key_count": len(keys.list_keys())}


# ---------------------------------------------------------------- static --

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/landing")
def landing():
    return FileResponse(STATIC_DIR / "landing.html")


@app.get("/style.css")
def style():
    return FileResponse(STATIC_DIR / "style.css", media_type="text/css")


@app.get("/app.js")
def js():
    return FileResponse(STATIC_DIR / "app.js", media_type="text/javascript")


@app.get("/logo.svg")
def logo():
    return FileResponse(STATIC_DIR / "logo.svg", media_type="image/svg+xml")
