"""
title: Digi Memory
author: Digiworks
description: Lets Digi remember a short note when the person asks. The person confirms it in Digi; Digi never remembers on its own.
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

    def remember_this(self, note: str, __metadata__: Optional[dict] = None) -> str:
        """
        Remember a short note for the person, ONLY when they clearly ask you to remember something ("remember that...", "keep in mind...").
        Never use it on your own initiative. This does NOT save it: Digi shows a confirmation card and the note is only kept when the person
        presses Confirm. Never say it is saved.
        :param note: The note, in the person's own words, as short as possible.
        """
        try:
            r = requests.post(
                self.valves.portal_url.rstrip("/") + "/api/internal/tools/memory.remember",
                json={"chat_id": (__metadata__ or {}).get("chat_id"), "args": {"text": note}},
                headers={"x-internal-key": self.valves.internal_key}, timeout=20,
            )
            body = r.json()
        except Exception as e:  # noqa: BLE001
            return f"I could not prepare that note just now ({type(e).__name__})."
        if r.status_code != 200:
            return body.get("error", "I cannot remember things for this account.")
        return body.get("message", "Prepared. Ask the person to confirm on the card.") + " Note: " + str(body.get("summary", ""))
