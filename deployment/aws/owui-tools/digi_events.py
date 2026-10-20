"""
title: Digi Events
author: Digiworks
description: Calendar invites for an event, sent from the organisation's mailbox after the person confirms them in Digi.
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

    def send_calendar_invite(
        self, title: str, date: str, start_time: str, end_time: str, attendees: str, location: str = "", description: str = "",
        __metadata__: Optional[dict] = None,
    ) -> str:
        """
        Prepare a calendar invite when the person asks to schedule an event or meeting and invite people to it. The attendees get a real
        calendar invite (Yes / Maybe / No) by email, and the person who asked is invited too. Use only email addresses the person gave you in
        this conversation; never guess or make one up, and ask if any are missing. This does NOT send it: Digi shows a confirmation card and the
        invite is only sent when the person presses Confirm. Never say it is sent; tell them to check the card and press Confirm.
        This does not reserve a room. If they also need a room, help them request one first and put that room in location.
        :param title: What the event is called.
        :param date: Date as YYYY-MM-DD.
        :param start_time: Start time as 24-hour HH:MM.
        :param end_time: End time as 24-hour HH:MM.
        :param attendees: Comma-separated email addresses of the people to invite.
        :param location: Where it is (room and building, or an online link), or empty.
        :param description: A short note for the invite, or empty.
        """
        args = {"title": title, "date": date, "start_time": start_time, "end_time": end_time, "attendees": attendees, "location": location, "description": description}
        try:
            r = requests.post(
                self.valves.portal_url.rstrip("/") + "/api/internal/tools/events.invite",
                json={"chat_id": (__metadata__ or {}).get("chat_id"), "args": args},
                headers={"x-internal-key": self.valves.internal_key}, timeout=20,
            )
            body = r.json()
        except Exception as e:  # noqa: BLE001
            return f"I could not prepare the invite just now ({type(e).__name__}). Please try again."
        if r.status_code != 200:
            return body.get("error", "I cannot send calendar invites for this account.")
        return body.get("message", "Prepared. Ask the person to confirm on the card.") + " Summary: " + str(body.get("summary", ""))
