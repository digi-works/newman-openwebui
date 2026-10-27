"""
title: Digi Events
author: Digiworks
description: Campus events to look up, and calendar invites sent from the organisation's mailbox after the person confirms them in Digi.
version: 0.2.0
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

    def search_events(
        self, from_date: str = "", to_date: str = "", query: str = "", include_classes: bool = False, __metadata__: Optional[dict] = None,
    ) -> str:
        """
        Look up events on campus: what is happening this week, on a date, or an event by name (games, talks, concerts, campus life).
        Use it for any question about campus events or what is on, and answer only from what it returns; never invent an event. Read only.
        :param from_date: First date as YYYY-MM-DD, or empty for today.
        :param to_date: Last date as YYYY-MM-DD, or empty for a week from from_date. At most 31 days.
        :param query: Words in the event name, e.g. "Jets" or "basketball", or empty for everything.
        :param include_classes: True only when the person asks about classes or courses.
        """
        args = {"from_date": from_date, "to_date": to_date, "query": query, "include_classes": include_classes}
        try:
            r = requests.post(
                self.valves.portal_url.rstrip("/") + "/api/internal/tools/events.search",
                json={"chat_id": (__metadata__ or {}).get("chat_id"), "args": args},
                headers={"x-internal-key": self.valves.internal_key}, timeout=20,
            )
            body = r.json()
        except Exception as e:  # noqa: BLE001
            return f"I could not look up events just now ({type(e).__name__}). Please try again."
        if r.status_code != 200:
            return body.get("error", "I cannot look up events for this account.")
        items = body.get("items", [])
        span = f"{body.get('from', from_date)} to {body.get('to', to_date)}"
        if not items:
            return f"No events found in Digi for {span}. Say so plainly; do not invent any. Student Life (events) or Athletics (games) can confirm."
        rows = "\n".join(f"- {i['date']} {i['start']} to {i['end']}: {i['name']}" + (f" ({i['location']})" if i.get("location") else "") for i in items)
        more = "\nThere are more; ask the person to narrow the dates or name." if body.get("more") else ""
        return f"Events {span}:\n{rows}{more}"

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
