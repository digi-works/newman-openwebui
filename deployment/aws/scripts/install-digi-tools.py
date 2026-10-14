"""Installs the Digi tool modules in Open WebUI, sets their valves, and points the Digi agent at them.

Changes made in Open WebUI are kept: a module that already exists keeps its code, access and other valve values (only portal_url and
internal_key are corrected if they differ), and the Digi agent only gains modules created by this run. --update digi_rooms[,digi_bookings]
replaces just those modules' code with the repo version (their name, access and valves are kept). --reset (or DIGI_RESET=1) restores
everything from this repo instead.

Usage: python scripts/install-digi-tools.py [--update digi_rooms] [--reset]
       python scripts/install-digi-tools.py --prefix t_ --portal-url http://digiworks-studio:3000 --key-name STUDIO_INTERNAL_KEY
       (the second form installs a separate set for the platform test stack: modules named t_digi_rooms and so on, calling the Studio instance)
Reads OWUI_ADMIN_TOKEN (or OWUI_API_KEY) and PORTAL_INTERNAL_KEY from .env. OWUI_URL defaults to http://localhost:3001.
The modules only call the portal tool gateway; Digi decides, per person and per turn, which of them are offered.
"""
import json, os, pathlib, sys, urllib.request, urllib.error

root = pathlib.Path(__file__).resolve().parent.parent
env = {}
for line in root.joinpath(".env").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.split(" #")[0].strip().strip("'\"")
token = os.environ.get("OWUI_ADMIN_TOKEN") or env.get("OWUI_ADMIN_TOKEN") or env.get("OWUI_API_KEY")
def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
PREFIX = arg("--prefix", "")
RESET = "--reset" in sys.argv or os.environ.get("DIGI_RESET") == "1"
UPDATE = {t.strip() for t in arg("--update", "").split(",") if t.strip()}
PORTAL_URL = arg("--portal-url", "http://digiworks-portal:3000")
key = env.get(arg("--key-name", "PORTAL_INTERNAL_KEY"), "")
base = os.environ.get("OWUI_URL", "http://localhost:3001").rstrip("/")
if UPDATE - {m for m in ("digi_rooms", "digi_bookings", "digi_approvals", "digi_memory", "digi_mcp")}:
    sys.exit(f"--update: unknown module(s) {', '.join(sorted(UPDATE - {'digi_rooms', 'digi_bookings', 'digi_approvals', 'digi_memory', 'digi_mcp'}))}")
if not token or len(key) < 16:
    sys.exit("Need an admin token and PORTAL_INTERNAL_KEY in .env")

MODULES = [
    ("digi_rooms", "Digi Rooms", "digi_rooms.py", "Room request form, available-room search and room list."),
    ("digi_bookings", "Digi Bookings", "digi_bookings.py", "Bookings, plus requests and cancellations the person confirms in Digi."),
    ("digi_approvals", "Digi Approvals (read only)", "digi_approvals.py", "The approval queue, read only."),
    ("digi_memory", "Digi Memory", "digi_memory.py", "Remember a note when the person asks (they confirm in Digi)."),
    ("digi_mcp", "Digi Connected Tools", "digi_mcp.py", "Tools from connected tool servers, called through Digi."),
]

def call(method, path, body=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]

created = []
for tid0, name, fname, desc in MODULES:
    tid = PREFIX + tid0
    payload = {"id": tid, "name": (name + " (test stack)") if PREFIX else name, "content": root.joinpath("owui-tools", fname).read_text(encoding="utf-8"), "meta": {"description": desc},
               "access_grants": [{"principal_type": "user", "principal_id": "*", "permission": "read"}]}
    exists = call("GET", f"/api/v1/tools/id/{tid}")[0] == 200
    if not exists:
        s, r = call("POST", "/api/v1/tools/create", payload)
        if s != 200: sys.exit(f"{tid} create -> {s} {r}")
        print(tid, "created"); created.append(tid)
    elif tid0 in UPDATE and not RESET:
        s, cur = call("GET", f"/api/v1/tools/id/{tid}")
        cur = cur if s == 200 and isinstance(cur, dict) else {}
        keep = {k: cur[k] for k in ("id", "name", "meta", "access_grants") if cur.get(k) is not None}
        s, r = call("POST", f"/api/v1/tools/id/{tid}/update", {**payload, **keep, "content": payload["content"]})
        print(tid, "code updated from repo ->", s, "" if s == 200 else r)
    elif RESET:
        s, r = call("POST", f"/api/v1/tools/id/{tid}/update", payload)
        print(tid, "reset from repo ->", s, "" if s == 200 else r)
    else:
        print(tid, "exists, left as is")
    # the connection back to the portal must be right whatever else was changed; other valve values are kept
    s, valves = call("GET", f"/api/v1/tools/id/{tid}/valves")
    valves = valves if s == 200 and isinstance(valves, dict) and not RESET else {}
    if valves.get("portal_url") == PORTAL_URL and valves.get("internal_key") == key:
        print(tid, "valves already correct")
    else:
        s, r = call("POST", f"/api/v1/tools/id/{tid}/valves/update", {**valves, "portal_url": PORTAL_URL, "internal_key": key})
        print(tid, "valves ->", s, "" if s == 200 else r)

if PREFIX:
    sys.exit(0)
# The Digi agent lists the modules (the portal still narrows them per person each turn).
s, model = call("GET", "/api/v1/models/model?id=digi")
if s == 200 and isinstance(model, dict):
    meta = model.get("meta") or {}
    have = meta.get("toolIds") or []
    want = [m[0] for m in MODULES] if RESET else have + [t for t in created if t not in have]
    if want == have:
        print("agent tools unchanged"); sys.exit(0)
    meta["toolIds"] = want
    form = {k: model.get(k) for k in ("id", "base_model_id", "name", "params", "access_grants", "is_active")}
    form["meta"] = meta
    form = {k: v for k, v in form.items() if v is not None}
    s2, r2 = call("POST", "/api/v1/models/model/update", form)
    print("agent tools ->", s2, "" if s2 == 200 else r2)
else:
    print("could not read the digi agent:", s, model)
