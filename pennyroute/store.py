"""PennyRoute — persistent state (models watchlist, fallback chains, settings, events).

All state lives in `data/` next to the package. JSON files are written atomically.
"""

import json
import os
import threading
import time
from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parent
DATA_DIR = _PKG_DIR.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

MODELS_FILE = DATA_DIR / "models.json"
CHAINS_FILE = DATA_DIR / "chains.json"
SETTINGS_FILE = DATA_DIR / "settings.json"
EVENTS_FILE = DATA_DIR / "events.jsonl"
TELEMETRY_FILE = DATA_DIR / "telemetry.json"
TELEMETRY_MAX = 288  # 24h @ 5min

_lock = threading.Lock()

DEFAULT_MODELS = [
    {"slug": "z-ai/glm-5.3-flash", "note": "GLM 5.3 Flash"},
    {"slug": "z-ai/glm-4.7-flash", "note": "GLM 4.7 Flash"},
    {"slug": "deepseek/deepseek-v4.1-flash-1017", "note": "DeepSeek V4.1 Flash"},
    {"slug": "deepseek/deepseek-v4-flash-0731", "note": "DeepSeek V4 Flash"},
    {"slug": "deepseek/deepseek-v3.2", "note": "DeepSeek V3.2"},
    {"slug": "qwen/qwen3.7-flash", "note": "Qwen3.7 Flash"},
    {"slug": "qwen/qwen3.6-flash", "note": "Qwen3.6 Flash"},
    {"slug": "qwen/qwen3.5-flash-02-23", "note": "Qwen3.5 Flash"},
    {"slug": "moonshotai/kimi-k2.7-code", "note": "Kimi K2.7 Code"},
    {"slug": "moonshotai/kimi-k2.5", "note": "Kimi K2.5"},
    {"slug": "google/gemini-3.8-flash", "note": "Gemini 3.8 Flash"},
    {"slug": "google/gemini-3.7-flash", "note": "Gemini 3.7 Flash"},
    {"slug": "minimax/minimax-m3.1-flash", "note": "MiniMax M3.1 Flash"},
    {"slug": "mistralai/mistral-small-2603", "note": "Mistral Small 4"},
    {"slug": "stepfun/step-3.7-flash", "note": "StepFun Step 3.7 Flash"},
    {"slug": "openai/gpt-5.4-mini", "note": "GPT-5.4 Mini"},
]

DEFAULT_CHAINS = [
    {
        "name": "free-first",
        "primary": False,
        "auto_apply": False,
        "entries": [
            {"type": "cheapest", "filter": ":free"},
            {"type": "cheapest"},
        ],
    },
    {
        "name": "main",
        "primary": True,
        "auto_apply": True,
        "entries": [
            {"type": "cheapest"},
        ],
    },
]

DEFAULT_SETTINGS = {
    "mix": {"in": 0.14, "cache": 0.85, "out": 0.01},
    "min_tps": 45,
    "min_uptime": 99.0,
    "interval_min": 5,
    "gateway_restart": True,
}


def _read_json(path: Path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write_json(path: Path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def load_models() -> list:
    return _read_json(MODELS_FILE, DEFAULT_MODELS)


def save_models(models: list):
    with _lock:
        _write_json(MODELS_FILE, models)


def add_model(slug: str, note: str = "") -> bool:
    models = load_models()
    if any(m["slug"] == slug for m in models):
        return False
    models.append({"slug": slug, "note": note})
    save_models(models)
    return True


def remove_model(slug: str) -> bool:
    models = load_models()
    n = len(models)
    models = [m for m in models if m["slug"] != slug]
    save_models(models)
    return len(models) < n


def load_chains() -> list:
    return _read_json(CHAINS_FILE, DEFAULT_CHAINS)


def save_chains(chains: list):
    with _lock:
        _write_json(CHAINS_FILE, chains)


def load_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    s.update(_read_json(SETTINGS_FILE, {}))
    return s


def save_settings(settings: dict):
    with _lock:
        _write_json(SETTINGS_FILE, settings)


def log_event(kind: str, detail: dict):
    line = json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "event": kind,
                       **detail}, ensure_ascii=False)
    with _lock:
        with open(EVENTS_FILE, "a") as f:
            f.write(line + "\n")


def load_events(limit: int = 100) -> list:
    try:
        with open(EVENTS_FILE) as f:
            lines = f.readlines()
    except FileNotFoundError:
        return []
    out = []
    for ln in reversed(lines[-limit:]):
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            continue
    return out


def push_telemetry(point: dict):
    """Append a routing snapshot (ts, model, provider, blended, tps, latency,
    uptime) into a rolling ring buffer (last TELEMETRY_MAX points)."""
    with _lock:
        data = _read_json(TELEMETRY_FILE, [])
        data.append(point)
        data = data[-TELEMETRY_MAX:]
        _write_json(TELEMETRY_FILE, data)


def load_telemetry(limit: int = TELEMETRY_MAX) -> list:
    data = _read_json(TELEMETRY_FILE, [])
    return data[-limit:]
