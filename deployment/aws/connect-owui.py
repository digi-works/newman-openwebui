#!/usr/bin/env python3
"""Connects this Digi deployment to a separate Open WebUI instance. Run from this folder, on any machine that can reach OWUI_URL:  python3 connect-owui.py

What it does (all idempotent, safe to re-run):
  1. checks OWUI_URL answers and OWUI_ADMIN_TOKEN is an admin
  2. creates 3 shared runtime accounts in Open WebUI and writes OWUI_RUNTIME_POOL into .env (Digi signs in as these; people have no Open WebUI accounts)
  3. installs the five Digi tool modules in Open WebUI, pointing back at https://DIGI_DOMAIN with PORTAL_INTERNAL_KEY
  4. creates the "Digi" model on OWUI_BASE_MODEL
Then restart the portal:  docker compose up -d portal
No secret is printed.
"""
import json, os, pathlib, secrets, string, subprocess, sys, urllib.error, urllib.request

here = pathlib.Path(__file__).resolve().parent
env_path = here / ".env"
lines = env_path.read_text(encoding="utf8").split("\n")
env = {}
for l in lines:
    if "=" in l and not l.lstrip().startswith("#"):
        k, v = l.split("=", 1)
        env[k.strip()] = v.split(" #")[0].strip().strip("'\"")
for k in ("OWUI_URL", "OWUI_ADMIN_TOKEN", "DIGI_DOMAIN", "PORTAL_INTERNAL_KEY", "OWUI_BASE_MODEL"):
    if not env.get(k): sys.exit(f"{k} is empty in .env")
base = env["OWUI_URL"].rstrip("/"); H = {"Authorization": "Bearer " + env["OWUI_ADMIN_TOKEN"], "Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}

def call(method, path, body=None):
    r = urllib.request.Request(base + path, method=method, headers=H, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=60) as x: return x.status, json.loads(x.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:300]
    except Exception as e: sys.exit(f"cannot reach {base}: {e}")

print("1. checking Open WebUI ...")
s, me = call("GET", "/api/v1/auths/")
if s != 200 or not isinstance(me, dict): sys.exit(f"admin token rejected ({s}). Create an API key in Open WebUI > Settings > Account.")
if me.get("role") != "admin": sys.exit("that token belongs to a non-admin user; use an admin's API key")
s, ver = call("GET", "/api/version"); print("   ok, signed in as", me.get("email"), "| version", ver.get("version") if isinstance(ver, dict) else "?")
s, models = call("GET", "/api/models")
ids = {m["id"] for m in models.get("data", [])} if s == 200 and isinstance(models, dict) else set()
if env["OWUI_BASE_MODEL"] not in ids: sys.exit(f"model '{env['OWUI_BASE_MODEL']}' is not in that Open WebUI. Models there: {sorted(ids)[:15]}. Add a connection/model first, or fix OWUI_BASE_MODEL.")

print("2. runtime accounts ...")
pool = json.loads(env["OWUI_RUNTIME_POOL"]) if env.get("OWUI_RUNTIME_POOL") else []
have = {p["email"] for p in pool}; alpha = string.ascii_letters + string.digits

def save_pool():
    # written after every account, so a later failure never loses a password for an account that already exists
    global lines
    val = "OWUI_RUNTIME_POOL='" + json.dumps(pool, separators=(",", ":")) + "'"
    out, done = [], False
    for l in lines:
        if l.startswith("OWUI_RUNTIME_POOL="): out.append(val); done = True
        else: out.append(l)
    if not done: out.append(val)
    lines = out
    env_path.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf8")

for i in range(1, 4):
    email = f"digi-runtime-{i}@digi.local"
    if email in have: continue
    pw = "".join(secrets.choice(alpha) for _ in range(32))
    s, r = call("POST", "/api/v1/auths/add", {"name": f"digi-runtime-{i}", "email": email, "password": pw, "role": "user"})
    if s != 200: sys.exit(f"could not create {email} ({s}): {r}. If it exists already, delete it in Open WebUI and re-run.")
    pool.append({"email": email, "password": pw})
    save_pool()
save_pool(); print(f"   {len(pool)} accounts saved to .env")

e = dict(os.environ, OWUI_URL=base, OWUI_BASE_MODEL=env["OWUI_BASE_MODEL"], OWUI_ADMIN_TOKEN=env["OWUI_ADMIN_TOKEN"])
print("3. tool modules ...")
subprocess.run([sys.executable, str(here / "scripts" / "install-digi-tools.py"), "--portal-url", "https://" + env["DIGI_DOMAIN"]], env=e, check=True)
print("4. Digi model ...")
subprocess.run([sys.executable, str(here / "scripts" / "create-digi.py")], env=e, check=True)
print("\nDone. Now:  docker compose up -d portal   then sign in and check Settings > AI connection.")
