"""
title: Digi Approvals (read only)
author: Digiworks
description: Shows the queue of room requests waiting for a decision. It cannot approve or decline; decisions are made by a person on the Bookings page.
version: 0.1.0
"""

from typing import Optional

import requests
from pydantic import BaseModel, Field


class Tools:
    class Valves(BaseModel):
        portal_url: str = Field(default="http://digiworks-portal:3000", description="Internal address of the portal")
        internal_key: str = Field(default="", description="Shared secret for the portal's internal API")

    def __init__(self):
        self.valves = self.Valves()

    def approval_queue(self, __metadata__: Optional[dict] = None) -> str:
        """
        List room requests that are waiting for a decision. Read only. You cannot approve or decline anything: tell the person to open the Bookings
        page to decide.
        """
        try:
            r = requests.post(
                self.valves.portal_url.rstrip("/") + "/api/internal/tools/approvals.queue",
                json={"chat_id": (__metadata__ or {}).get("chat_id"), "args": {}},
                headers={"x-internal-key": self.valves.internal_key}, timeout=20,
            )
            body = r.json()
        except Exception as e:  # noqa: BLE001
            return f"I could not look up the queue just now ({type(e).__name__})."
        if r.status_code != 200:
            return body.get("error", "I cannot show the approval queue for this account.")
        items = body.get("items", [])
        if not items:
            return "Nothing is waiting for a decision."
        lines = [f"- {i['ref']}: {i['room']} on {i['date']} {i['start']} to {i['end']}, {i['people']} people, {i['purpose']} (requested by {i['requestedBy']})" for i in items]
        return "\n".join(lines) + "\nTo decide, open the Bookings page."
