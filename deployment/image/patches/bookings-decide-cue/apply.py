"""Patch the built portal so an approver can tell from the Bookings table which requests need their decision.

Usage: python3 apply.py <app dir extracted from digiworks-portal:release, with the earlier patches applied> files
For a person who can decide, every waiting request shows "Approve or decline" next to its status, its row is announced as
"waiting for your decision", and the Awaiting approval queue says to open a request to decide it. Patched in the bookings
view's browser chunk (renamed so browsers do not reuse the cached old file; the /bookings manifest is updated) and its
server-render chunk, which must match.
"""
import pathlib
import re
import sys

OLD_CHUNK = "45b5nwileyx2a-cancel1"
NEW_CHUNK = "45b5nwileyx2a-decide1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
SSR = ".next/server/chunks/ssr/src_components_bookings-view_tsx_1fok5rl._.js"
MANIFEST = ".next/server/app/(app)/bookings/page_client-reference-manifest.js"
BLURB = "Requests waiting for a decision. Open one to approve or decline it."
CUE = "rounded-md bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground"

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])


def one(pattern, text, what):
    found = re.findall(pattern, text)
    if len(found) != 1:
        sys.exit(f"{what}: expected 1 match, found {len(found)}")
    return found[0]


def patch(s):
    # the minifier names things differently in each chunk, so read the names first
    decide, own = one(r"canDecide:(\w+),canEdit:\w+,canCancel:\w+,canRequest:\w+,ownOnly:(\w+)=!1", s, "props")
    b = one(r'"aria-label":`Open booking for \$\{(\w+)\.room\}`', s, "row")
    jsx, badge = one(r'\(0,(\w+)\.jsx\)\("td",\{className:"whitespace-nowrap px-5 py-3\.5 text-right",children:(\(0,\w+\.jsx\)\(\w+\.Badge,\{[^}]*\}\))\}\)', s, "status cell")
    edits = [
        (re.compile(r"children:(\w+)\.blurb\}\)"),
         lambda m: f'children:{decide}&&!{own}&&"awaiting"==={m[1]}.value?"{BLURB}":{m[1]}.blurb}})'),
        (re.compile(r'"aria-label":`Open booking for \$\{\w+\.room\}`'),
         lambda m: f'"aria-label":`Open booking for ${{{b}.room}}${{{decide}&&"Tentative"==={b}.status?", waiting for your decision":""}}`'),
        (re.compile(r'\(0,\w+\.jsx\)\("td",\{className:"whitespace-nowrap px-5 py-3\.5 text-right",children:\(0,\w+\.jsx\)\(\w+\.Badge,\{[^}]*\}\)\}\)'),
         lambda m: (f'(0,{jsx}.jsx)("td",{{className:"whitespace-nowrap px-5 py-3.5 text-right",children:(0,{jsx}.jsxs)("div",{{className:"flex items-center justify-end gap-2",'
                    f'children:[{decide}&&"Tentative"==={b}.status&&(0,{jsx}.jsx)("span",{{"aria-hidden":!0,className:"{CUE}",children:"Approve or decline"}}),{badge}]}})}})')),
    ]
    for rx, rep in edits:
        s, k = rx.subn(rep, s)
        if k != 1:
            sys.exit(f"{rx.pattern[:40]}: expected 1 match, found {k}")
    return s


def write(rel, text):
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print("wrote", dest)


write(CLIENT.replace(OLD_CHUNK, NEW_CHUNK), patch((app / CLIENT).read_text()))
write(SSR, patch((app / SSR).read_text()))

m = (app / MANIFEST).read_text()
# listed both as "/_next/static/chunks/<name>.js" (client references) and "static/chunks/<name>.js" (entry files)
if m.count(f"static/chunks/{OLD_CHUNK}.js") < 2:
    sys.exit("manifest: chunk references not found")
write(MANIFEST, m.replace(f"static/chunks/{OLD_CHUNK}.js", f"static/chunks/{NEW_CHUNK}.js"))
