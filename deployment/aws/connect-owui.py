#!/usr/bin/env python3
"""Connects this Digi deployment to a separate Open WebUI instance. Run from this folder, on any machine that can reach OWUI_URL:  python3 connect-owui.py [--reset]

What it does (safe to re-run):
  1. checks OWUI_URL answers and OWUI_ADMIN_TOKEN is an admin
  2. creates 3 shared runtime accounts in Open WebUI and writes OWUI_RUNTIME_POOL (plus OWUI_RUNTIME_EMAIL/PASSWORD = the first one) into .env (Digi signs in as these; people have no Open WebUI accounts)
  3. creates the "Digi" model on OWUI_BASE_MODEL
  4. installs the five Digi tool modules in Open WebUI, pointing back at https://DIGI_DOMAIN with PORTAL_INTERNAL_KEY
Anything that already exists in Open WebUI is left as it is there, so changes made in Open WebUI survive a re-run; only the tools' portal
address and key are corrected. --reset overwrites Digi and its tools with the versions in this repo.
Then restart the portal:  docker compose up -d portal
No secret is printed.
"""
import json, os, pathlib, secrets, string, subprocess, sys, urllib.error, urllib.request
sys.stdout.reconfigure(line_buffering=True)  # keep our lines in order with the sub-scripts' output

here = pathlib.Path(__file__).resolve().parent
RESET = "--reset" in sys.argv
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

def set_env(key, val):
    global lines
    out, done = [], False
    for l in lines:
        if l.startswith(key + "="): out.append(f"{key}={val}"); done = True
        else: out.append(l)
    if not done: out.append(f"{key}={val}")
    lines = out

def save_pool():
    # written after every account, so a later failure never loses a password for an account that already exists
    set_env("OWUI_RUNTIME_POOL", "'" + json.dumps(pool, separators=(",", ":")) + "'")
    # agent and tool management sign in with a single account, not the pool: use the first one
    if pool: set_env("OWUI_RUNTIME_EMAIL", pool[0]["email"]); set_env("OWUI_RUNTIME_PASSWORD", pool[0]["password"])
    env_path.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf8")

for i in range(1, 4):
    email = f"digi-runtime-{i}@digi.local"
    if email in have: continue
    pw = "".join(secrets.choice(alpha) for _ in range(32))
    s, r = call("POST", "/api/v1/auths/add", {"name": f"digi-runtime-{i}", "email": email, "password": pw, "role": "user"})
    if s != 200: sys.exit(f"could not create {email} ({s}): {r}. If it exists already, delete it in Open WebUI and re-run.")
    pool.append({"email": email, "password": pw})
    save_pool()
save_pool(); print(f"   {len(pool)} accounts saved to .env")

e = dict(os.environ, OWUI_URL=base, OWUI_BASE_MODEL=env["OWUI_BASE_MODEL"], OWUI_ADMIN_TOKEN=env["OWUI_ADMIN_TOKEN"], DIGI_RESET="1" if RESET else "0")
if RESET: print("   --reset: Digi and its tools will be overwritten with the versions in this repo")
print("3. Digi model ...")
subprocess.run([sys.executable, str(here / "scripts" / "create-digi.py")], env=e, check=True)
print("4. tool modules ...")
subprocess.run([sys.executable, str(here / "scripts" / "install-digi-tools.py"), "--portal-url", "https://" + env["DIGI_DOMAIN"]], env=e, check=True)
print("\nDone. Now:  docker compose up -d portal   then sign in and check Settings > AI connection.")
