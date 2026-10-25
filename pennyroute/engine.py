"""PennyRoute — the fallback-chain router engine.

A background thread periodically evaluates the primary chain and, if the
resolved entry differs from what's currently in ~/.hermes/config.yaml, applies
the switch (model.default + provider_routing.order) and restarts the gateway.

Only ONE chain is primary (drives config). Other chains are stored recipes.
"""

import os
import subprocess
import threading
import time
from pathlib import Path

import yaml

from . import ranking
from . import store

HOME = Path.home()
CONFIG_PATH = HOME / ".hermes" / "config.yaml"

_stop = threading.Event()
_thread: threading.Thread | None = None
_last_state: dict = {}


def read_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return yaml.safe_load(CONFIG_PATH.read_text()) or {}
    except yaml.YAMLError:
        return {}


def current_active() -> dict:
    cfg = read_config()
    return {
        "model": (cfg.get("model") or {}).get("default") or "",
        "order": list((cfg.get("provider_routing") or {}).get("order") or []),
        "config_path": str(CONFIG_PATH),
    }


def apply_choice(model: str, provider: str, restart: bool = True) -> dict:
    cfg = read_config()
    cfg.setdefault("model", {})["default"] = model
    cfg["model"]["provider"] = "openrouter"
    cfg["model"]["base_url"] = "https://openrouter.ai/api/v1"
    # provider_routing.order must be a real YAML list — a string silently
    # disables the pin (known Hermes pitfall).
    cfg.setdefault("provider_routing", {})["order"] = [provider]
    CONFIG_PATH.write_text(
        yaml.safe_dump(cfg, sort_keys=False, default_flow_style=False))

    restart_result = "skipped"
    if restart:
        try:
            time.sleep(1.5)
            subprocess.Popen(
                ["hermes", "gateway", "run", "--replace"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True)
            restart_result = "restarted"
        except Exception as e:  # noqa: BLE001
            restart_result = f"failed: {e}"

    store.log_event("apply", {"model": model, "provider": provider,
                              "gateway": restart_result})
    return {"model": model, "provider": provider, "gateway": restart_result}


def evaluate_primary() -> dict:
    """Resolve the primary chain against fresh rankings; return a report."""
    settings = store.load_settings()
    models = store.load_models()
    chains = store.load_chains()
    primary = next((c for c in chains if c.get("primary")), None)
    if not primary:
        return {"ok": False, "reason": "no primary chain"}
    if not models:
        return {"ok": False, "reason": "watchlist empty"}

    ranked = ranking.rank_models(models, settings["mix"],
                                 {"min_tps": settings["min_tps"],
                                  "min_uptime": settings["min_uptime"]})
    res = ranking.resolve_chain(primary, ranked, settings["mix"],
                                {"min_tps": settings["min_tps"],
                                 "min_uptime": settings["min_uptime"]})
    report = {"ok": bool(res), "chain": primary["name"], "resolution": res,
              "active": current_active(), "auto_apply": primary.get("auto_apply", True)}

    if res and primary.get("auto_apply", True):
        active = current_active()
        if (res["model"] != active["model"]
                or res["provider"] != (active["order"][0] if active["order"] else None)):
            store.log_event("switch", {
                "from": f"{active['model']} @ {active['order']}",
                "to": f"{res['model']} @ {res['provider']}",
                "reason": res["reason"],
                "blended": res["blended"]})
            report["applied"] = apply_choice(
                res["model"], res["provider"],
                restart=settings.get("gateway_restart", True))
        else:
            report["applied"] = "unchanged"
        # telemetry snapshot: what the router is serving right now
        store.push_telemetry({
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "model": res["model"],
            "provider": res["provider"],
            "blended": res["blended"],
        })
    return report


def _loop():
    while not _stop.is_set():
        try:
            evaluate_primary()
        except Exception as e:  # noqa: BLE001 — never kill the router thread
            store.log_event("engine_error", {"error": str(e)})
        interval = max(1, store.load_settings().get("interval_min", 5))
        _stop.wait(interval * 60)


def start():
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="pennyroute-engine", daemon=True)
    _thread.start()


def stop():
    _stop.set()


def last_state() -> dict:
    return _last_state
