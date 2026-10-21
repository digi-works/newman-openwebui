"""
title: Digi Rooms
author: Digiworks
description: Room request form, available-room search, single-room availability check and room list for Digi (Newman University). Calls the Digi tool gateway; Digi decides who may use it.
version: 0.4.0
"""

import json
from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo
from typing import Optional

import requests
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

FONT = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">'
)

BASE_CSS = r"""
* { box-sizing: border-box; }
body { margin: 0; padding: 4px; font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #11204b; background: transparent; }
.card { border: 1px solid #e3e7ee; border-radius: 18px; overflow: hidden; background: #fff; max-width: 900px; }
.head { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; background: #f7f9fc; border-bottom: 1px solid #e3e7ee; }
.head b { font-size: 17px; font-weight: 600; }
.head span { font-size: 14px; color: #6b7690; }
.body { padding: 22px 24px 24px; }
label { display: block; font-size: 14px; font-weight: 500; margin: 0 0 8px; color: #28345a; }
input, select { width: 100%; height: 46px; padding: 0 14px; border: 1px solid #d8deea; border-radius: 12px; font: inherit; font-size: 15px; color: #11204b; background: #fff; }
input:focus, select:focus, button:focus-visible { outline: 3px solid rgba(17, 32, 75, .18); border-color: #11204b; }
.row { display: grid; gap: 16px; margin-bottom: 18px; }
.r3 { grid-template-columns: 1.1fr 1fr 1fr; }
.r2 { grid-template-columns: 1fr 1fr; }
.chips { display: flex; flex-wrap: wrap; gap: 10px; }
.chip { border: 1px solid #d8deea; background: #fff; color: #28345a; border-radius: 999px; padding: 9px 18px; font: inherit; font-size: 14px; cursor: pointer; }
.chip[aria-pressed="true"] { background: #11204b; border-color: #11204b; color: #fff; }
.foot { display: flex; justify-content: flex-end; border-top: 1px solid #eceff5; margin-top: 22px; padding-top: 20px; }
.primary { border: 0; border-radius: 12px; padding: 13px 24px; font: inherit; font-size: 15px; font-weight: 500; cursor: pointer; background: #11204b; color: #fff; }
.primary:disabled { background: #dfe3ec; color: #fff; cursor: not-allowed; }
.ghost { border: 1px solid #d8deea; background: #fff; color: #11204b; border-radius: 12px; padding: 10px 18px; font: inherit; font-size: 14px; cursor: pointer; }
@media (max-width: 640px) { .r3, .r2 { grid-template-columns: 1fr; } }
"""

HEIGHT_JS = r"""
function reportHeight() { parent.postMessage({ type: "iframe:height", height: document.documentElement.scrollHeight }, "*"); }
window.addEventListener("load", reportHeight);
if (window.ResizeObserver) { new ResizeObserver(reportHeight).observe(document.body); }
"""

BUILDINGS = [
    "Administration", "Athletic Complex", "Campus Ministry", "DeMattias Hall", "Education Hall",
    "Fine Arts Center", "Learning Commons", "Library", "Science Hall", "Student Union",
]
NEEDS = ["Display", "Projector", "Moveable seating", "Whiteboard", "Accessible entry"]


def _page(body: str, script: str) -> str:
    return f'<!DOCTYPE html><html><head><meta charset="utf-8">{FONT}<style>{BASE_CSS}</style></head><body>{body}<script>{script}{HEIGHT_JS}</script></body></html>'


def _html(content: str) -> HTMLResponse:
    return HTMLResponse(content=content, headers={"Content-Disposition": "inline"})


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

    # ------------------------------------------------------------------ step 1
    def show_room_request_form(self, __metadata__: Optional[dict] = None) -> tuple:
        """
        Show the room request form (step 1 of 2). Use this as soon as the person wants to book,
        reserve or request a room or space. Do not ask for the details in text.
        """
        buildings = BUILDINGS
        try:
            code, body = self._call("rooms.form", {}, __metadata__)
            if code == 403:
                return "Your account is not allowed to request rooms.", {"status": "denied"}
            buildings = body.get("buildings") or BUILDINGS
        except Exception:  # noqa: BLE001
            pass
        options = "".join(f'<option value="{escape(str(b))}">{escape(str(b))}</option>' for b in buildings)
        chips = "".join(f'<button type="button" class="chip" aria-pressed="false" data-need="{n}">{n}</button>' for n in NEEDS)
        body = f"""
<div class="card">
  <div class="head"><b>Room request</b><span>Step 1 of 2</span></div>
  <form id="f" class="body" novalidate>
    <div class="row"><div><label for="purpose">What is the booking for?</label>
      <input id="purpose" maxlength="200" placeholder="e.g. Study group, club meeting" autocomplete="off"></div></div>
    <div class="row r3">
      <div><label for="date">Date</label><input id="date" type="date"></div>
      <div><label for="start">Start</label><input id="start" type="time" value="14:00"></div>
      <div><label for="end">End</label><input id="end" type="time" value="15:00"></div>
    </div>
    <div class="row r2">
      <div><label for="people">How many people?</label>
        <div style="position:relative"><input id="people" type="number" min="1" max="500" value="6">
        <div style="position:absolute;right:8px;top:7px;display:flex;gap:6px">
          <button type="button" class="ghost" id="minus" style="padding:4px 12px" aria-label="Fewer people">&minus;</button>
          <button type="button" class="ghost" id="plus" style="padding:4px 12px" aria-label="More people">+</button></div></div></div>
      <div><label for="building">Preferred building</label>
        <select id="building"><option value="">No preference</option>{options}</select></div>
    </div>
    <div class="row" style="margin-bottom:0"><div><label>Anything the room needs?</label><div class="chips">{chips}</div></div></div>
    <div class="foot"><button type="submit" class="primary" id="go" disabled>Find available rooms</button></div>
  </form>
</div>"""
        script = r"""
const $ = (id) => document.getElementById(id);
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// the same starting values as the Request a room page: today, 14:00 to 15:00, 6 people
$("date").min = today; $("date").value = today;
const needs = new Set();
function valid() {
  const ok = $("purpose").value.trim() && $("date").value >= today && $("start").value && $("end").value && $("end").value > $("start").value && Number($("people").value) >= 1;
  $("go").disabled = !ok;
}
["purpose", "date", "start", "end", "people"].forEach((i) => $(i).addEventListener("input", valid));
$("minus").onclick = () => { $("people").value = Math.max(1, Number($("people").value || 1) - 1); valid(); };
$("plus").onclick = () => { $("people").value = Math.min(500, Number($("people").value || 0) + 1); valid(); };
document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
  const on = c.getAttribute("aria-pressed") !== "true";
  c.setAttribute("aria-pressed", String(on));
  on ? needs.add(c.dataset.need) : needs.delete(c.dataset.need);
}));
// The portal frame is sandboxed without form submission, so the click (also fired by Enter) does the work, not the submit event.
const submitForm = (e) => {
  e.preventDefault();
  if ($("go").disabled) return;
  const data = { purpose: $("purpose").value.trim(), date: $("date").value, start_time: $("start").value, end_time: $("end").value,
    people: Number($("people").value), building: $("building").value, needs: Array.from(needs) };
  const text = "Find me an available room.\nPurpose: " + data.purpose + "\nDate: " + data.date + "\nTime: " + data.start_time + " to " + data.end_time +
    "\nPeople: " + data.people + "\nBuilding: " + (data.building || "No preference") + "\nNeeds: " + (data.needs.join(", ") || "None") +
    "\n\n<!--room-request " + JSON.stringify(data) + "-->";
  $("go").disabled = true; $("go").textContent = "Searching...";
  parent.postMessage({ type: "input:prompt:submit", text }, "*");
};
$("f").addEventListener("submit", submitForm);
$("go").addEventListener("click", submitForm);
valid();
"""
        return _html(_page(body, script)), {"status": "displayed", "form": "room request", "step": 1, "writes_performed": False}

    # ------------------------------------------------------------------ step 2
    def find_available_rooms(
        self, purpose: str, date: str, start_time: str, end_time: str, people: int, building: str = "", needs: str = "", __metadata__: Optional[dict] = None
    ) -> tuple:
        """
        Find rooms that are free for a request (step 2 of 2). Call this right after the room request form is submitted.
        :param purpose: What the booking is for.
        :param date: Date as YYYY-MM-DD.
        :param start_time: Start time as 24-hour HH:MM.
        :param end_time: End time as 24-hour HH:MM.
        :param people: Number of people.
        :param building: Preferred building, or empty for no preference.
        :param needs: Comma-separated needs such as Display, Projector, Moveable seating, Whiteboard, Accessible entry.
        """
        need_list = [n.strip() for n in needs.split(",") if n.strip()] if needs else []
        try:
            code, body = self._call("rooms.search", {"date": date, "start_time": start_time, "end_time": end_time, "people": people, "building": building, "needs": need_list}, __metadata__)
            if code in (400, 403, 409):
                return body.get("error", "I cannot search rooms for this account."), {"status": "denied"}
            if code != 200:
                raise RuntimeError(code)
            rooms = body.get("rooms", [])
            note = body.get("note", "")
        except Exception as e:  # noqa: BLE001
            return f"I could not check room availability just now ({type(e).__name__}). Please try again in a moment.", {"status": "error"}

        sel_base = {"purpose": purpose, "date": date, "start_time": start_time, "end_time": end_time, "people": people, "needs": need_list}
        if rooms:
            items = ""
            for rm in rooms:
                sel = dict(sel_base, room=rm["name"])
                tags = ", ".join(rm.get("tags", [])) or rm.get("features", "")
                items += (
                    '<div class="item"><div><b>{n}</b><div class="sub">{b} &middot; fits {c} &middot; {t}</div></div>'
                    '<button class="primary pick" data-sel=\'{s}\'>Request this room</button></div>'
                ).format(n=escape(str(rm["name"])), b=escape(str(rm["building"])), c=escape(str(rm["capacity"])), t=escape(str(tags)), s=escape(json.dumps(sel)))
            hint = f'<div class="sub" style="padding:12px 24px 0">{escape(str(note))}</div>' if note else ""
            inner = f'{hint}<div class="list">{items}</div>'
        else:
            inner = f'<div class="body" style="padding:24px"><b>No rooms are free for that time.</b><div class="sub" style="margin-top:6px">{escape(str(note)) if note else "Try another time or date."}</div></div>'
        extra_css = ".list{padding:8px 24px 20px}.item{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid #eceff5}.item:last-child{border-bottom:0}.sub{font-size:13px;color:#6b7690;margin-top:4px}.pick{padding:10px 16px;font-size:14px}"
        body = f'<style>{extra_css}</style><div class="card"><div class="head"><b>Available rooms</b><span>Step 2 of 2</span></div>{inner}</div>'
        script = r"""
document.querySelectorAll(".pick").forEach((b) => b.addEventListener("click", () => {
  const s = JSON.parse(b.dataset.sel);
  b.disabled = true; b.textContent = "Requesting...";
  const text = "Request " + s.room + " for " + s.purpose + " on " + s.date + " from " + s.start_time + " to " + s.end_time + " for " + s.people + " people.\n\n<!--room-select " + JSON.stringify(s) + "-->";
  parent.postMessage({ type: "input:prompt:submit", text }, "*");
}));
"""
        # the model only sees this dict, not the card, so name the rooms: otherwise it cannot tell which ones are free
        free = [str(rm["name"]) for rm in rooms]
        return _html(_page(body, script)), {
            "status": "displayed", "step": 2, "rooms_found": len(rooms), "free_rooms_shown": free, "note": note,
            "important": "Only the rooms in free_rooms_shown are known to be free. A room missing from it may be taken; use check_room_availability before saying anything about a specific room.",
            "writes_performed": False,
        }

    # ------------------------------------------------------------------ one room
    def _find_room(self, room: str, md: Optional[dict]):
        """The room's listing (name, building, capacity), looked up by name ignoring case, spaces and dashes."""
        want = "".join(ch for ch in room.lower() if ch.isalnum())
        match = lambda items: next((i for i in items if "".join(ch for ch in str(i.get("name", "")).lower() if ch.isalnum()) == want), None)
        code, body = self._call("rooms.list", {"building": "", "min_capacity": 0}, md)
        if code != 200:
            return code, body, None
        hit = match(body.get("items", []))
        if hit:
            return code, body, hit
        # the full list is capped, so look building by building
        code, form = self._call("rooms.form", {}, md)
        for b in form.get("buildings", []) if code == 200 else []:
            c2, b2 = self._call("rooms.list", {"building": b, "min_capacity": 0}, md)
            hit = match(b2.get("items", [])) if c2 == 200 else None
            if hit:
                return c2, b2, hit
        return 200, {}, None

    def check_room_availability(self, room: str, date: str, start_time: str, end_time: str, __metadata__: Optional[dict] = None) -> str:
        """
        Check whether ONE specific room is free at a date and time, using the same rules as booking (events and waiting or approved
        requests both make a room busy). Use it whenever someone asks if a named room is free or available, and before saying any
        specific room is free or taken. Never answer that from memory, from list_rooms, or from earlier messages.
        :param room: The room's name, e.g. D254.
        :param date: Date as YYYY-MM-DD.
        :param start_time: Start time as 24-hour HH:MM.
        :param end_time: End time as 24-hour HH:MM. If the person gave no end time, ask for it first.
        """
        try:
            # the search does not refuse past times (only a request does), so check here; Newman runs on Central time
            if datetime.fromisoformat(f"{date}T{end_time}").replace(tzinfo=ZoneInfo("America/Chicago")) <= datetime.now(ZoneInfo("America/Chicago")):
                return f"{date} {start_time}-{end_time} has already passed, so {room} cannot be booked then. Ask for a future date or time."
        except ValueError:
            return "Give the date as YYYY-MM-DD and the times as 24-hour HH:MM."
        try:
            code, body, hit = self._find_room(room, __metadata__)
            if code != 200:
                return body.get("error", "I cannot look up rooms for this account.")
            if not hit:
                return f"I could not find a room called {room}. Do not guess; ask the person to check the room name, or use list_rooms."
            name, building, capacity = str(hit["name"]), str(hit["building"]), int(hit["capacity"])
            # the booking engine's own search, narrowed to this room's building and size so the room ranks first among what is free
            code, res = self._call("rooms.search", {"date": date, "start_time": start_time, "end_time": end_time, "people": capacity, "building": building, "needs": []}, __metadata__)
            if code in (400, 403, 409):
                return res.get("error", "I cannot check availability for this account.")
            if code != 200:
                raise RuntimeError(code)
        except Exception as e:  # noqa: BLE001
            return f"I could not check {room} just now ({type(e).__name__}). Do not say whether it is free; ask the person to try again in a moment."
        rooms = res.get("rooms", [])
        if any(str(r.get("name")) == name for r in rooms):
            return (f"{name} ({building}, holds {capacity}) is FREE on {date} from {start_time} to {end_time}. Nothing is held yet: "
                    "it is only held once a request is made, and every request still needs staff approval.")
        crowded = len(rooms) >= 6 and all(int(r.get("capacity", 0)) == capacity for r in rooms)
        if crowded:
            return (f"I could not confirm whether {name} is free on {date} from {start_time} to {end_time}. Do not say it is free. "
                    "Offer to show the free rooms for that time instead (show_room_request_form).")
        others = ", ".join([str(r.get("name")) for r in rooms if str(r.get("building")) == building][:3])
        return (f"{name} is NOT free on {date} from {start_time} to {end_time}: an event or another request already holds it. "
                f"Do not say it is free.{' Free rooms like it in ' + building + ': ' + others + '.' if others else ''}")

    # ------------------------------------------------------------------ read-only lookup
    def list_rooms(self, building: str = "", min_capacity: int = 0, __metadata__: Optional[dict] = None) -> str:
        """
        List bookable rooms on campus with building, capacity and features. Use for questions like
        "what rooms are in the Library" or "rooms that hold 30 people". Read only. It does not say whether a room is free:
        use check_room_availability for that.
        :param building: Building name to filter by, or empty for all.
        :param min_capacity: Smallest capacity wanted, or 0 for any.
        """
        try:
            code, body = self._call("rooms.list", {"building": building, "min_capacity": min_capacity}, __metadata__)
            if code != 200:
                return body.get("error", "I cannot look up rooms for this account.")
        except Exception as e:  # noqa: BLE001
            return f"I could not look up rooms just now ({type(e).__name__})."
        items = body.get("items", [])
        if not items:
            return "No rooms matched."
        return "\n".join(f"- {i['name']} ({i['building']}): holds {i['capacity']}, {i['features']}" for i in items[:40])
