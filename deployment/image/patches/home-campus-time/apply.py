"""Patch the built portal so the home page's date and greeting use campus time on the server and in the browser (QA DEF-19).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release> files
HomeLanding (src/components/home-landing.tsx) took the hour and the date from the machine it ran on: the server renders in UTC, then the
browser redraws in its own zone, so in the evening (Central) the page first showed tomorrow's date and "Good morning", then changed.
Both now use America/Chicago, as the room request form already does for "today", so server and browser agree and the day is the
campus day. Patched in the home page's browser chunk (renamed so browsers do not reuse the cached old file; the manifest is updated)
and its server-render chunk.
"""
import pathlib
import sys

TZ = "America/Chicago"
OLD_CHUNK = "24_12p3phqwvo"
NEW_CHUNK = "24_12p3phqwvo-tz1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
SSR = ".next/server/chunks/ssr/_02304xc._.js"
MANIFEST = ".next/server/app/(app)/page_client-reference-manifest.js"


def edit(now, hour, date):
    old = f'{now}=new Date,{hour}={now}.getHours(),{date}={now}.toLocaleDateString("en-US",{{weekday:"long",day:"numeric",month:"long"}})'
    new = (f'{now}=new Date,{hour}=Number(new Intl.DateTimeFormat("en-US",{{hour:"numeric",hourCycle:"h23",timeZone:"{TZ}"}}).format({now})),'
           f'{date}={now}.toLocaleDateString("en-US",{{weekday:"long",day:"numeric",month:"long",timeZone:"{TZ}"}})')
    return old, new


app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])


def patch(rel, dest_rel, names):
    s = (app / rel).read_text()
    old, new = edit(*names)
    if s.count(old) != 1:
        sys.exit(f"{rel}: expected 1 match, found {s.count(old)}")
    dest = out / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(s.replace(old, new))
    print("wrote", dest)


patch(CLIENT, CLIENT.replace(OLD_CHUNK, NEW_CHUNK), ("d", "c", "f"))
patch(SSR, SSR, ("j", "k", "s"))
m = (app / MANIFEST).read_text()
# listed both as "/_next/static/chunks/<name>.js" (client references) and "static/chunks/<name>.js" (entry files)
if m.count(f"static/chunks/{OLD_CHUNK}.js") < 2:
    sys.exit("manifest: chunk references not found")
dest = out / MANIFEST
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(m.replace(f"static/chunks/{OLD_CHUNK}.js", f"static/chunks/{NEW_CHUNK}.js"))
print("wrote", dest)
