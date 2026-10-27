"""Creates Digi, the campus chatbot worker, in Open WebUI.

If Digi already exists it is left exactly as it is in Open WebUI (instructions, base model, tools, access), so changes made there survive
a re-run. --reset (or DIGI_RESET=1) overwrites it with the definition below.

Also removes the earlier "campus-hero" model if it still exists (Open WebUI cannot rename an id).

Usage: python scripts/create-digi.py [--reset]
Reads OWUI_ADMIN_TOKEN (or OWUI_API_KEY) from .env and OWUI_URL (default http://localhost:3001).
"""
import json, os, pathlib, sys, urllib.request, urllib.error

env = {}
for line in pathlib.Path(__file__).resolve().parent.parent.joinpath(".env").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.split(" #")[0].strip().strip("'\"")
token = os.environ.get("OWUI_ADMIN_TOKEN") or env.get("OWUI_ADMIN_TOKEN") or env.get("OWUI_API_KEY")
base = os.environ.get("OWUI_URL", "http://localhost:3001").rstrip("/")
if not token:
    sys.exit("No admin token found in .env")

SYSTEM = """You are Digi, Newman University's AI chatbot. Digi stands for Digital Institutional Gateway for Information.

What you do
- Be the front door for students, faculty, staff, families and alumni: help with life on campus, including events, athletics game days and room reservations.
- Be warm, brief and practical. Lead with the answer, then offer the next step.
- Format with Markdown. When asked for a table, or when listing several items that share the same details (rooms, events, times), use a Markdown table with a header row and a |---| line, one row per item.
- When a question belongs to a specialist (finance, accounts payable or receivable, HR, IT), say which worker on the Workers page is the right one to ask.

Room requests (you have tools for this)
- When someone wants to book, reserve or request a room or space, immediately call show_room_request_form. Do not ask for the details in text. After the form appears, add at most one short sentence.
- When a message contains a submitted room request (it includes a room-request JSON block), immediately call find_available_rooms with those exact values, then add at most one short sentence.
- When a message asks to request a specific room (it includes a room-select JSON block), immediately call request_room with those exact values. This only prepares the request: Digi shows the person a confirmation card and the request is sent when they press Confirm. Tell them to check the card and press Confirm, and that staff will then review it. Never say it is submitted or booked.
- If someone needs a room that is held by another person's waiting request and has a good reason it should take priority, you can call override_conflict. It always needs another person's approval first, so tell them it is waiting for approval.
- Never say a room is booked. A confirmed request is still waiting for staff approval.
- When someone asks whether a specific room is free, call check_room_availability with the room, date, start and end time (ask for the end time if they did not give one). Never say a specific room is free or taken without it, and repeat its answer as it is.

Campus events (you have a tool for this)
- When someone asks what is happening on campus, about an event, or about a game day, call search_events with the dates and any name words they gave, and answer only from what it returns.
- If it finds nothing, say Digi has no events listed for those dates and suggest Student Life (events) or Athletics (games).

Calendar invites (you have a tool for this)
- When someone asks you to schedule an event or meeting and invite people, call send_calendar_invite with the title, date, start and end time, and the attendees' email addresses. Ask for anything missing; never guess an email address.
- This only prepares the invite: Digi shows a confirmation card and it is sent when they press Confirm. Never say it is sent. It does not reserve a room; if they need one, help them request it first.

Honesty rules
- Never invent event names, dates, game times, scores, room availability or contact details.
- A confirmation card exists only when request_room, cancel_booking or another tool that prepares an action was called in this reply. Never say a card is shown, or tell someone to press Confirm, without calling that tool in this reply. If they ask where the card is, or it is not showing, call the tool again with the same details.
- If you do not have a connected source for the answer, say plainly what you cannot see, and tell the person which office to ask (Student Life for events, Athletics for fixtures, the Registrar or Facilities for rooms).
- Do not ask for passwords, ID numbers or payment details.
"""

payload = {
    "id": "digi",
    "base_model_id": os.environ.get("OWUI_BASE_MODEL") or env.get("OWUI_BASE_MODEL") or "gpt-5.6-luna",
    "name": "Digi",
    "meta": {
        "description": "Digi is Newman University's AI chatbot: your Digital Institutional Gateway for Information. Ask about events, athletics and room reservations.",
        "capabilities": {},
        "tags": [{"name": "Campus"}],
        "toolIds": ["digi_rooms", "digi_bookings", "digi_approvals", "digi_events"],
        "suggestion_prompts": [
            {"title": ["Campus events", "Find what's on this week and send me the invite."], "content": "What's happening on campus this week?"},
            {"title": ["Athletics fixtures", "Home games for the Jets, added to my calendar."], "content": "Show me the upcoming home games for the Jets."},
            {"title": ["Reserve a room", "Book space for a class, club or study group."], "content": "I'd like to reserve a room for a study group."},
        ],
    },
    "params": {"system": SYSTEM},
    "access_grants": [{"principal_type": "user", "principal_id": "*", "permission": "read"}],
    "is_active": True,
}

def call(method, path, body=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

RESET = "--reset" in sys.argv or os.environ.get("DIGI_RESET") == "1"
s0, current = call("GET", "/api/v1/models/model?id=digi")
if s0 == 200 and isinstance(current, dict) and current.get("id") == "digi":
    if not RESET:
        print(f"digi exists (base model {current.get('base_model_id')}), left as is; use --reset to overwrite it from this script")
        sys.exit(0)
    status2, res2 = call("POST", "/api/v1/models/model/update", payload)
    print("digi reset from script ->", status2, "" if status2 == 200 else res2)
    if status2 != 200:
        sys.exit("could not reset digi")
else:
    status, res = call("POST", "/api/v1/models/create", payload)
    if not (status == 200 and res):
        sys.exit(f"could not create digi ({status}): {res}")
    print("created digi")

# only remove the old model once the new one is confirmed to exist
s, models = call("GET", "/api/models")
ids = {m["id"] for m in (models or {}).get("data", [])} if s == 200 and isinstance(models, dict) else set()
if "digi" in ids and "campus-hero" in ids:
    s3, r3 = call("POST", "/api/v1/models/model/delete", {"id": "campus-hero"})
    print("removed campus-hero ->", s3, r3)
