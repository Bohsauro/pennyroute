"""PennyRoute — API key management.

Keys are shown in full only at creation time; storage keeps a sha256 hash plus
a display prefix. Auth for /v1/* accepts the raw key via the X-API-Key header
or a Bearer authorization header.
"""

import hashlib
import json
import os
import secrets
import threading
import time

from .store import DATA_DIR, _read_json, _write_json

KEYS_FILE = DATA_DIR / "keys.json"
_lock = threading.Lock()


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def create_key(name: str) -> dict | None:
    """Create a key. Returns {'id', 'name', 'key'} — full key shown ONCE."""
    raw = "pnk-" + secrets.token_urlsafe(24)
    entry = {
        "id": secrets.token_hex(4),
        "name": (name or "default").strip() or "default",
        "prefix": raw[:12],
        "hash": _hash(raw),
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "last_used": None,
    }
    with _lock:
        keys = _read_json(KEYS_FILE, [])
        keys.append(entry)
        _write_json(KEYS_FILE, keys)
    return {"id": entry["id"], "name": entry["name"], "key": raw}


def list_keys() -> list:
    with _lock:
        keys = _read_json(KEYS_FILE, [])
    return [{"id": k["id"], "name": k["name"], "prefix": k["prefix"],
             "created": k["created"], "last_used": k.get("last_used")}
            for k in keys]


def revoke_key(key_id: str) -> bool:
    with _lock:
        keys = _read_json(KEYS_FILE, [])
        n = len(keys)
        keys = [k for k in keys if k["id"] != key_id]
        _write_json(KEYS_FILE, keys)
        return len(keys) < n


def verify_key(raw: str | None) -> bool:
    if not raw:
        return False
    raw = raw.strip()
    if raw.startswith("Bearer "):
        raw = raw[7:]
    h = _hash(raw)
    with _lock:
        keys = _read_json(KEYS_FILE, [])
    for k in keys:
        if k["hash"] == h:
            k["last_used"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            with _lock:
                _write_json(KEYS_FILE, keys)
            return True
    return False


def has_any_key() -> bool:
    return bool(list_keys())
