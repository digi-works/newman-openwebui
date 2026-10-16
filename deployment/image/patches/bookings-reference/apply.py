"""Patch the built portal so the bookings table shows each booking's reference (QA DEF-15).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release> files
The reference (e.g. BK-7K2QX) is shown in small text under the room name, so a person holding a reference can find the row
(Cmd/Ctrl+F) without opening each one. Patched in the bookings view's browser chunk (renamed so browsers do not reuse the cached old
file; the /bookings manifest is updated) and its server-render chunk, which must match.
"""
import pathlib
import sys

OLD_CHUNK = "45b5nwileyx2a"
NEW_CHUNK = "45b5nwileyx2a-ref1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
SSR = ".next/server/chunks/ssr/src_components_bookings-view_tsx_1fok5rl._.js"
MANIFEST = ".next/server/app/(app)/bookings/page_client-reference-manifest.js"


def cell(jsx, b):
    old = f'(0,{jsx}.jsx)("td",{{className:"px-5 py-3.5 font-medium",children:{b}.room}})'
    new = (f'(0,{jsx}.jsxs)("td",{{className:"px-5 py-3.5 font-medium",children:[{b}.room,'
           f'(0,{jsx}.jsx)("div",{{className:"font-mono text-xs font-normal text-muted-foreground",children:{b}.ref}})]}})')
    return old, new


app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])


def patch(rel, dest_rel, jsx, b):
    s = (app / rel).read_text()
    old, new = cell(jsx, b)
    if s.count(old) != 1:
        sys.exit(f"{rel}: expected 1 match, found {s.count(old)}")
    dest = out / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(s.replace(old, new))
    print("wrote", dest)


patch(CLIENT, CLIENT.replace(OLD_CHUNK, NEW_CHUNK), "t", "e")
patch(SSR, SSR, "b", "a")
m = (app / MANIFEST).read_text()
# listed both as "/_next/static/chunks/<name>.js" (client references) and "static/chunks/<name>.js" (entry files)
if m.count(f"static/chunks/{OLD_CHUNK}.js") < 2:
    sys.exit("manifest: chunk references not found")
dest = out / MANIFEST
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(m.replace(f"static/chunks/{OLD_CHUNK}.js", f"static/chunks/{NEW_CHUNK}.js"))
print("wrote", dest)
