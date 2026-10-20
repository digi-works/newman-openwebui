"""Patch the built portal so Settings > AI updates explains the Release address instead of showing a made-up example (QA DEF-22).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release, with the earlier patches applied> files
Writes the patched browser chunk (under a new name, so browsers do not reuse the cached old one), the server-render chunk
(the placeholder is in the server HTML, and hydration does not replace it) and the /settings/updates page's client
manifest into files/, mirroring their paths under /app.
"""
import pathlib
import re
import sys

OLD_CHUNK = "20dr4g_i5s3q7"
NEW_CHUNK = "20dr4g_i5s3q7-hint1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
SSR = ".next/server/chunks/ssr/_0_v7pxv._.js"
MANIFEST = ".next/server/app/(app)/settings/updates/page_client-reference-manifest.js"

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

# the minifier names the jsx runtime (j) and the Input module (m) differently in each chunk
OLD = re.compile(r'\((0,(\w+)\.jsx)\)\((\w+)\.Input,\{id:"url",value:(\w+),onChange:(\w+)=>(\w+)\(\5\.target\.value\),placeholder:"https://releases\.example\.com"\}\)')


def new(m):
    jsx, _, inp, val, ev, setv = m.groups()
    return (f'({jsx})({inp}.Input,{{id:"url",value:{val},onChange:{ev}=>{setv}({ev}.target.value),'
            f'placeholder:"Paste the address you were given","aria-describedby":"url-hint"}}),'
            f'({jsx})("p",{{id:"url-hint",className:"text-xs text-muted-foreground",'
            f'children:"The https address that came with your enrollment token. If you do not have it, ask whoever gave you the token."}})')


def write(rel, text):
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print("wrote", dest)


for src, dest in ((CLIENT, CLIENT.replace(OLD_CHUNK, NEW_CHUNK)), (SSR, SSR)):
    s, k = OLD.subn(new, (app / src).read_text())
    if k != 1:
        sys.exit(f"{src}: expected 1 match, found {k}")
    write(dest, s)

m = (app / MANIFEST).read_text()
# listed both as "/_next/static/chunks/<name>.js" (client references) and "static/chunks/<name>.js" (entry files)
if m.count(f"static/chunks/{OLD_CHUNK}.js") < 2:
    sys.exit("manifest: chunk references not found")
write(MANIFEST, m.replace(f"static/chunks/{OLD_CHUNK}.js", f"static/chunks/{NEW_CHUNK}.js"))
