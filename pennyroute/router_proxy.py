"""PennyRoute — OpenAI-compatible reverse proxy with chain-based failover.

Resolves the primary fallback chain (or an explicit one) into an ordered list
of candidate (model, provider) pairs, then forwards /v1/chat/completions to
OpenRouter. If a candidate errors, the next one is tried; the client never
sees the switch.

Request model field routing rules:
  - "penny" or "penny:<chain>"  -> resolve that chain (default: primary)
  - any other value              -> treated as a model id; provider = auto
"""

import json
import time

import httpx
from fastapi import HTTPException, Request

from . import orclient, ranking
from . import store


def build_candidates(chain: dict, settings: dict) -> list[dict]:
    """Ordered candidate list for a chain: [(model, provider), ...].

    Within a chain step, all healthy endpoints of the target model are added
    (cheapest first) so a provider error tries the next provider of the SAME
    model before falling through to the next chain step.
    """
    mix = settings["mix"]
    gates = {"min_tps": settings["min_tps"], "min_uptime": settings["min_uptime"]}
    ranked = ranking.rank_models(store.load_models(), mix, gates)
    out: list[dict] = []
    seen: set = set()

    def add(slug: str, provider: str | None):
        key = (slug, provider)
        if key not in seen:
            seen.add(key)
            out.append({"model": slug, "provider": provider})

    for entry in chain.get("entries") or []:
        if entry.get("type") == "cheapest":
            flt = entry.get("filter") or ""
            pool = [m for m in ranked if flt in m["slug"]] if flt else ranked
            # healthy, cheapest blended first
            for m in pool:
                b = m.get("best")
                if b and b.get("healthy"):
                    add(m["slug"], b["provider"])
        else:
            slug = entry.get("model")
            if not slug:
                continue
            want = entry.get("provider") or "auto"
            eps = [e for e in ranking.rank_endpoints(slug, mix, gates)
                   if not (isinstance(e, dict) and "error" in e)]
            healthy = [e for e in eps if e["healthy"]]
            if want != "auto":
                pinned = [e for e in healthy if e["provider"] == want]
                if pinned:
                    add(slug, want)
                # if the pinned provider is down, fall through to next step
            else:
                for e in healthy:
                    add(slug, e["provider"])
    return out


async def proxy_chat(request: Request, body: dict):
    """Forward a chat completion through the chain. Returns httpx.Response."""
    settings = store.load_settings()
    mix = settings["mix"]
    gates = {"min_tps": settings["min_tps"], "min_uptime": settings["min_uptime"]}

    requested = (body.get("model") or "").strip()
    if requested.startswith("penny:"):
        chain_name = requested[6:] or None
    elif requested == "penny":
        chain_name = None
    elif requested and requested in [c["name"] for c in store.load_chains()]:
        chain_name = requested
    else:
        # fixed model passthrough: route it through cheapest-healthy providers
        chain = {"name": "_passthrough", "entries": [{"type": "model",
                 "model": requested or (store.load_chains()[0]["name"]
                                        if store.load_chains() else "")}]}
        candidates = build_candidates(chain, settings) if requested else []
        if not candidates:
            # unknown model: let the primary chain decide
            chains = store.load_chains()
            primary = next((c for c in chains if c.get("primary")), None)
            candidates = build_candidates(primary, settings) if primary else []
        return await _forward(request, body, candidates)

    chains = store.load_chains()
    if chain_name:
        chain = next((c for c in chains if c["name"] == chain_name), None)
    else:
        chain = next((c for c in chains if c.get("primary")), None)
    if not chain:
        raise HTTPException(404, f"chain not found: {chain_name or 'primary'}")

    candidates = build_candidates(chain, settings)
    if not candidates:
        raise HTTPException(502, "no healthy candidate in chain")
    return await _forward(request, body, candidates)


async def _forward(request: Request, body: dict, candidates: list[dict]):
    """Try candidates in order. Streams through on success."""
    last_error = None
    stream = bool(body.get("stream"))

    for cand in candidates:
        payload = dict(body)
        payload["model"] = cand["model"]
        if cand["provider"]:
            payload["provider"] = {"order": [cand["provider"]],
                                   "allow_fallbacks": False}
        headers = {
            "Authorization": f"Bearer {orclient.get_key()}",
            "Content-Type": "application/json",
        }
        try:
            if stream:
                client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=600.0))
                req = client.build_request(
                    "POST", "https://openrouter.ai/api/v1/chat/completions",
                    content=json.dumps(payload).encode(), headers=headers)
                raw = await client.send(req, stream=True)
                if raw.status_code >= 400:
                    await raw.aclose()
                    await client.aclose()
                    last_error = f"{raw.status_code} @ {cand['model']}/{cand['provider']}"
                    continue
                return StreamingResp(raw, client)
            else:
                async with httpx.AsyncClient(
                        timeout=httpx.Timeout(10.0, read=600.0)) as client:
                    raw = await client.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        content=json.dumps(payload).encode(), headers=headers)
                if raw.status_code >= 400:
                    last_error = f"{raw.status_code} @ {cand['model']}/{cand['provider']}"
                    continue
                data = raw.json()
                data.setdefault("pennyroute", {
                    "served_by": f"{cand['model']} @ {cand['provider']}",
                    "chain_tried": len(candidates)})
                return data
        except Exception as e:  # noqa: BLE001
            last_error = f"{type(e).__name__}: {e} @ {cand['model']}/{cand['provider']}"
            continue

    store.log_event("proxy_error", {"error": last_error})
    raise HTTPException(502, f"all chain candidates failed; last: {last_error}")


from fastapi.responses import StreamingResponse  # noqa: E402


class StreamingResp(StreamingResponse):
    """StreamingResponse that owns the httpx client and closes it after."""

    def __init__(self, raw, client: httpx.AsyncClient):
        self._client = client
        super().__init__(raw.aiter_bytes(), status_code=raw.status_code,
                         headers=dict(raw.headers),
                         media_type=raw.headers.get("content-type"))

    async def stream_response(self, send):
        try:
            await super().stream_response(send)
        finally:
            await self._client.aclose()
