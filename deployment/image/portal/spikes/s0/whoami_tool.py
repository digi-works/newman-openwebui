"""
title: Digi S0 spike - who is asking
description: Spike only. Proves a tool call can recover the real Digi user from the OWUI chat id, with one shared runtime account.
"""
import json
from typing import Optional

import requests
from pydantic import BaseModel, Field


class Tools:
    class Valves(BaseModel):
        gateway_url: str = Field(default="http://host.docker.internal:8791", description="Digi tool gateway (spike)")
        internal_key: str = Field(default="", description="Shared secret for the gateway")

    def __init__(self):
        self.valves = self.Valves()

    def whoami(self, __metadata__: Optional[dict] = None, __user__: Optional[dict] = None) -> str:
        """
        Find out which person is talking to Digi right now. Call this whenever you are asked who is asking.
        Takes no arguments.
        """
        md = __metadata__ or {}
        payload = {"chat_id": md.get("chat_id"), "message_id": md.get("message_id"), "session_id": md.get("session_id")}
        try:
            r = requests.post(
                self.valves.gateway_url.rstrip("/") + "/whoami", json=payload,
                headers={"x-internal-key": self.valves.internal_key}, timeout=10,
            )
            gw = {"status": r.status_code, **(r.json() if r.headers.get("content-type", "").startswith("application/json") else {})}
        except Exception as e:  # noqa: BLE001
            gw = {"status": "error", "error": type(e).__name__}
        return json.dumps({
            "gateway": gw,
            "owui_runtime_user": (__user__ or {}).get("email"),
            "metadata_keys": sorted(md.keys()),
            "seen_chat_id_prefix": str(md.get("chat_id"))[:14],
        })
