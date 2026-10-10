"""
title: Digi Connected Tools
author: Digiworks
description: Calls tools on connected tool servers through Digi. Digi decides who may use each tool; this module holds no credentials of its own.
version: 0.1.0
"""

import json
import re
from typing import Optional

import requests
from pydantic import BaseModel, Field

# Only connected (mcp.*) tools may be called through this module; the name goes into the gateway URL.
TOOL_NAME = re.compile(r"mcp\.[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+)*")

class Tools:
    class Valves(BaseModel):
        portal_url: str = Field(default="http://digiworks-portal:3000", description="Internal address of the portal")
        internal_key: str = Field(default="", description="Shared secret for the portal's internal API")

    def __init__(self):
        self.valves = self.Valves()

    def _call(self, name: str, args: dict, md: Optional[dict]):
        r = requests.post(
            self.valves.portal_url.rstrip("/") + "/api/internal/tools/" + name,
            json={"chat_id": (md or {}).get("chat_id"), "args": args},
            headers={"x-internal-key": self.valves.internal_key}, timeout=60,
        )
        try:
            body = r.json()
        except Exception:  # noqa: BLE001
            body = {}
        return r.status_code, body

    def list_connected_tools(self, __metadata__: Optional[dict] = None) -> str:
        """
        List the connected tools this person may use, with what each one does and the arguments it takes. Call this before using call_connected_tool.
        """
        try:
            code, body = self._call("mcp.list", {}, __metadata__)
        except Exception as e:  # noqa: BLE001
            return f"I could not look up the connected tools just now ({type(e).__name__})."
        if code != 200:
            return body.get("error", "I cannot list connected tools for this account.")
        items = body.get("items", [])
        if not items:
            return "No connected tools are available to this person."
        return "\n".join(f"- {i['tool']} ({i['risk']}): {i['description']}. Arguments: {json.dumps(i['input_schema'].get('properties', {}))}" for i in items)

    def call_connected_tool(self, tool: str, arguments_json: str = "{}", __metadata__: Optional[dict] = None) -> str:
        """
        Call one connected tool by its full name from list_connected_tools (for example mcp.erp.get_invoice). Some tools need another person's
        approval first; if so, say it is waiting for approval and never say it is done.
        :param tool: The full tool name, exactly as listed.
        :param arguments_json: The arguments as a JSON object string.
        """
        if not TOOL_NAME.fullmatch(tool or ""):
            return "Unknown tool. Use a full name exactly as list_connected_tools shows it, for example mcp.erp.get_invoice."
        try:
            args = json.loads(arguments_json or "{}")
            if not isinstance(args, dict):
                raise ValueError("not an object")
        except Exception:  # noqa: BLE001
            return "The arguments must be a JSON object."
        try:
            code, body = self._call(tool, args, __metadata__)
        except Exception as e:  # noqa: BLE001
            return f"I could not call that tool just now ({type(e).__name__})."
        if code != 200:
            return body.get("error", "I cannot use that tool.")
        if body.get("pending") or body.get("pending_approval"):
            return body.get("message", "Prepared and waiting.") + " Summary: " + str(body.get("summary", ""))
        return str(body.get("result", ""))[:8000]
