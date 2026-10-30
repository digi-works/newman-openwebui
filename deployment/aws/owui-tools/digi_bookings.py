"""
title: Digi Bookings
author: Digiworks
description: A person's bookings, plus requests and cancellations that Digi prepares and the person confirms in Digi.
version: 0.5.0
"""

from typing import Optional

import requests
from pydantic import BaseModel, Field


# Status words as the Bookings page shows them.
SHOWN = {"Tentative": "Waiting"}


class Tools:
    class Valves(BaseModel):
        portal_url: str = Field(default="http://digiworks-portal:3000", description="Internal address of the portal")
        internal_key: str = Field(default="", description="Shared secret for the portal's internal API")

    def __init__(self):
        self.valves = self.Valves()

    def _call(self, name: str, args: dict, md: Optional[dict]):
        """One gateway call. Digi recovers the real person from the per-turn chat id; the Open WebUI account is a shared runtime account."""
        r = requests.post(
            self.valves.portal_url.rstrip("/") + "/api/internal/tools/" + name,
            json={"chat_id": (md or {}).get("chat_id"), "args": args},
            headers={"x-internal-key": self.valves.internal_key}, timeout=20,
        )
        try:
            body = r.json()
        except Exception:  # noqa: BLE001
            body = {}
        return r.status_code, body

    def list_bookings(self, ref: str = "", date: str = "", status: str = "", __metadata__: Optional[dict] = None) -> str:
        """
        List room bookings. People who may not see every booking get only their own. Use for "what is booked on 2026-10-14",
        "which requests are still waiting", "my bookings" or "who requested BK-WTEVG" (each line names the requester). Read only.
        When the person names a booking reference (BK-...), pass it as ref: it is found on any date, past ones too.
        :param ref: Booking reference such as BK-WTEVG, or empty.
        :param date: Date as YYYY-MM-DD, or empty for upcoming ones plus requests still waiting.
        :param status: One of Waiting, Confirmed, Declined, Cancelled, Expired, or empty for all.
        """
        # The portal's internal word for a waiting request is "Tentative"; people see "Waiting" everywhere, so Digi uses the same word.
        wanted = status.strip().lower()
        status = "Tentative" if wanted in ("waiting", "pending", "tentative") else status
        try:
            code, body = self._call("bookings.list", {"ref": ref.strip(), "date": date, "status": status}, __metadata__)
        except Exception as e:  # noqa: BLE001
            return f"I could not look up bookings just now ({type(e).__name__})."
        if code != 200:
            return body.get("error", "I cannot look up bookings for this account.")
        items = body.get("items", [])
        if not items:
            return f"No booking {ref.strip()} among the bookings this person may see." if ref.strip() else "No bookings matched."
        return "\n".join(
            f"- {i['ref']}: {i['date']} {i['start']} to {i['end']}: {i['room']} ({i['building']}), {i['purpose']}, {SHOWN.get(i['status'], i['status'])}, "
            f"requested by {i.get('requestedBy') or 'unknown'} ({i.get('email') or 'no email'})"
            for i in items[:40]
        )

    def request_room(
        self, room: str, purpose: str, date: str, start_time: str, end_time: str, people: int, needs: str = "", __metadata__: Optional[dict] = None
    ) -> str:
        """
        Prepare a room request when the person picks a room. This does NOT submit it: Digi shows the person a confirmation card and the request is
        only sent when they press Confirm there. Never tell the person it is submitted; tell them to check the card and press Confirm.
        The card only exists once this is called: never mention a card without calling it, and call it again if they cannot see the card.
        :param room: Exact room name chosen.
        :param purpose: What the booking is for.
        :param date: Date as YYYY-MM-DD.
        :param start_time: Start time as 24-hour HH:MM.
        :param end_time: End time as 24-hour HH:MM.
        :param people: Number of people.
        :param needs: Comma-separated needs.
        """
        args = {"room": room, "purpose": purpose, "date": date, "start_time": start_time, "end_time": end_time, "people": people,
                "needs": [n.strip() for n in needs.split(",") if n.strip()] if needs else []}
        try:
            code, body = self._call("bookings.request", args, __metadata__)
        except Exception as e:  # noqa: BLE001
            return f"I could not prepare the request just now ({type(e).__name__}). Please try again."
        if code != 200:
            return body.get("error", "I could not prepare that request.")
        return body.get("message", "Prepared. Ask the person to confirm on the card.") + " Summary: " + str(body.get("summary", ""))

    def cancel_booking(self, reference: str, __metadata__: Optional[dict] = None) -> str:
        """
        Prepare the cancellation of one of the person's own bookings by its reference (for example BK-7K2QX). This does NOT cancel it: Digi shows a
        confirmation card and it is only cancelled when the person presses Confirm. Never say it is cancelled.
        :param reference: The booking reference, for example BK-7K2QX.
        """
        try:
            code, body = self._call("bookings.cancel", {"ref": reference}, __metadata__)
        except Exception as e:  # noqa: BLE001
            return f"I could not prepare the cancellation just now ({type(e).__name__})."
        if code != 200:
            return body.get("error", "I could not prepare that cancellation.")
        return body.get("message", "Prepared. Ask the person to confirm on the card.") + " Summary: " + str(body.get("summary", ""))

    def override_conflict(
        self, room: str, purpose: str, date: str, start_time: str, end_time: str, people: int, reason: str, __metadata__: Optional[dict] = None
    ) -> str:
        """
        Ask to take a room that is held by someone else's WAITING request, when this one should take priority. This always needs another person's
        approval first, so it is only sent for approval; it does not take the room. Never say it is done. Tell the person it is waiting for approval.
        :param room: Exact room name.
        :param purpose: What the booking is for.
        :param date: Date as YYYY-MM-DD.
        :param start_time: Start time as 24-hour HH:MM.
        :param end_time: End time as 24-hour HH:MM.
        :param people: Number of people.
        :param reason: Why this request should take priority.
        """
        args = {"room": room, "purpose": purpose, "date": date, "start_time": start_time, "end_time": end_time, "people": people, "reason": reason}
        try:
            code, body = self._call("bookings.override_conflict", args, __metadata__)
        except Exception as e:  # noqa: BLE001
            return f"I could not send that for approval just now ({type(e).__name__})."
        if code != 200:
            return body.get("error", "I could not send that for approval.")
        return body.get("message", "Sent for approval.") + " " + str(body.get("summary", ""))
