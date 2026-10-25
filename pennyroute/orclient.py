"""PennyRoute — OpenRouter API client with in-memory caching.

Endpoints data is cached raw (10 min) so re-ranking with different cost mixes
never re-fetches. The full catalog is cached for 1 h (used for model search).
"""

import json
import os
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

HOME = Path.home()
ENV_FILE = HOME / ".hermes" / ".env"

ENDPOINTS_TTL = 600
CATALOG_TTL = 3600

_lock = threading.Lock()
_cache: dict = {}


def get_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        return key.strip()
    # project-local .env (gitignored) — installer writes the key here
    try:
        for line in (Path.cwd() / ".env").read_text().splitlines():
            if line.startswith("OPENROUTER_API_KEY="):
                v = line.split("=", 1)[1].strip()
                if v:
                    return v
    except (FileNotFoundError, OSError):
        pass
    prefix = "OPENROUTER_API_" + "KEY="
    try:
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(prefix):
                return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""


def _get(url: str, timeout: int = 40):
    """GET JSON. Returns {'__error': str} on any failure (never raises)."""
    key = get_key()
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception as e:  # noqa: BLE001 — report, don't crash the router
        return {"__error": str(e)}


def _g(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_endpoints_raw(slug: str, force: bool = False) -> list | dict:
    """Raw endpoint list for a model. list on success, {'error': ...} on failure."""
    now = time.time()
    with _lock:
        hit = _cache.get("ep:" + slug)
        if hit and not force and now - hit["ts"] < ENDPOINTS_TTL:
            return hit["data"]

    enc = urllib.parse.quote(slug, safe="/")
    data = _get(f"https://openrouter.ai/api/v1/models/{enc}/endpoints")
    if "__error" in data:
        raw = {"error": data["__error"]}
    else:
        eps = (data.get("data") or {}).get("endpoints") or []
        rows = []
        for ep in eps:
            pn = ep.get("provider_name")
            if not pn:
                continue
            pr = ep.get("pricing") or {}
            disc = _g(pr.get("discount")) or 0.0
            mult = 1.0 - disc
            prompt = _g(pr.get("prompt"))
            cache = _g(pr.get("input_cache_read"))
            comp = _g(pr.get("completion"))
            if prompt is None:
                continue
            rows.append({
                "provider": pn,
                "quant": ep.get("quantization") or "",
                "in": prompt * mult * 1e6,
                # cache not exposed -> pessimistic estimate = input price
                "cache": (cache * mult * 1e6) if cache is not None else (prompt * mult * 1e6),
                "cache_est": cache is None,
                "out": (comp * mult * 1e6) if comp is not None else None,
                "discount": disc,
                "latency": _g((ep.get("latency_last_30m") or {}).get("p50")),
                "tps": _g((ep.get("throughput_last_30m") or {}).get("p50")),
                "uptime": _g(ep.get("uptime_last_1d")),
            })
        raw = rows
    with _lock:
        _cache["ep:" + slug] = {"ts": now, "data": raw}
    return raw


def fetch_catalog(force: bool = False) -> list | dict:
    """Full model catalog (id, name, list pricing). Used for the model search box."""
    now = time.time()
    with _lock:
        hit = _cache.get("catalog")
        if hit and not force and now - hit["ts"] < CATALOG_TTL:
            return hit["data"]
    data = _get("https://openrouter.ai/api/v1/models", timeout=60)
    if "__error" in data:
        out = {"error": data["__error"]}
    else:
        out = []
        for m in data.get("data") or []:
            pr = m.get("pricing") or {}
            out.append({
                "id": m.get("id"),
                "name": m.get("name"),
                "in": _g(pr.get("prompt")),
                "out": _g(pr.get("completion")),
                "ctx": m.get("context_length"),
            })
    with _lock:
        _cache["catalog"] = {"ts": now, "data": out}
    return out


def search_catalog(query: str, limit: int = 20) -> list:
    cat = fetch_catalog()
    if isinstance(cat, dict):
        return cat
    q = (query or "").strip().lower()
    hits = []
    for m in cat:
        if not q or q in m["id"].lower() or q in (m["name"] or "").lower():
            hits.append(m)
            if len(hits) >= limit:
                break
    return hits
