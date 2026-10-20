"""Installs the S0 spike tool in Open WebUI. Usage: python spikes/s0/install.py"""
import json, pathlib, sys, urllib.request, urllib.error

root = pathlib.Path(__file__).resolve().parents[2]
env = {}
for line in root.joinpath(".env").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"')
token, key = env["OWUI_API_KEY"], env["PORTAL_INTERNAL_KEY"]
base = "http://localhost:3001"
TOOL_ID = "digi_s0_whoami"
content = root.joinpath("spikes", "s0", "whoami_tool.py").read_text(encoding="utf-8")


def call(method, path, body=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


payload = {"id": TOOL_ID, "name": "Digi S0 whoami", "content": content, "meta": {"description": "S0 spike"},
           "access_grants": [{"principal_type": "user", "principal_id": "*", "permission": "read"}]}
s, r = call("POST", "/api/v1/tools/create", payload)
if s != 200:
    s2, r2 = call("POST", f"/api/v1/tools/id/{TOOL_ID}/update", payload)
    print("create ->", s, "| update ->", s2, "" if s2 == 200 else r2)
else:
    print("tool created")
s, r = call("POST", f"/api/v1/tools/id/{TOOL_ID}/valves/update", {"gateway_url": "http://host.docker.internal:8791", "internal_key": key})
print("valves ->", s, "" if s == 200 else r)
