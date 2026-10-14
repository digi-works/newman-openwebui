"""Patch the built portal so the room request form never books from outdated search results (QA DEF-11, DEF-12).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release> files
Writes the patched browser chunk (under a new name, so browsers do not reuse the cached old one) and the
/bookings/new page's client manifest into files/, mirroring their paths under /app. The server-render chunk
needs no change: it always renders the form with no results, which this patch does not alter.
"""
import pathlib
import sys

OLD_CHUNK = "0eamtwqza3ecy"
NEW_CHUNK = "0eamtwqza3ecy-stale1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
MANIFEST = ".next/server/app/(app)/bookings/new/page_client-reference-manifest.js"

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

# (what, old, new): each old text must occur exactly once in the chunk
EDITS = [
    # state: are the results gone because the form changed? clear() drops results the moment the form no longer matches them
    ("state", "[b,y]=(0,a.useState)(null);async function N(e){",
     "[b,y]=(0,a.useState)(null),[__st,__setSt]=(0,a.useState)(!1),__clr=()=>{g&&(j(null),__setSt(!0))};async function N(e){"),
    # a new search clears the notice
    ("search", 'x("search"),f(""),j(null);', 'x("search"),f(""),j(null),__setSt(!1);'),
    # any edit to a field, or a search the browser blocks as invalid, clears the old results
    ("form", "(0,t.jsxs)(\"form\",{onSubmit:N,", "(0,t.jsxs)(\"form\",{onSubmit:N,onChange:__clr,onInvalidCapture:__clr,"),
    # the "needs" chips are buttons, not inputs, so they clear explicitly
    ("needs", "onClick:()=>u(t=>t.includes(e)?t.filter(t=>t!==e):[...t,e])",
     "onClick:()=>{__clr(),u(t=>t.includes(e)?t.filter(t=>t!==e):[...t,e])}"),
    # tell the person why the results went away
    ("notice", 'h&&(0,t.jsx)("p",{role:"alert",',
     '__st&&(0,t.jsx)("p",{role:"status",className:"rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground",children:"You changed the search. Press Find available rooms again to see what is free."}),h&&(0,t.jsx)("p",{role:"alert",'),
    # show what the results are for, so it is clear which date and time a request will use
    ("summary", '(0,t.jsx)("div",{className:"border-b px-5 py-3.5 text-sm font-semibold",children:"Available rooms"})',
     '(0,t.jsxs)("div",{className:"border-b px-5 py-3.5 text-sm font-semibold",children:["Available rooms",(0,t.jsxs)("span",{className:"font-normal text-muted-foreground",'
     'children:[" · ",new Date(g.q.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}),", ",g.q.start,"–",g.q.end,", ",g.q.people,1===g.q.people?" person":" people"]})]})'),
]


def write(rel, text):
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print("wrote", dest)


s = (app / CLIENT).read_text()
for what, old, new in EDITS:
    if s.count(old) != 1:
        sys.exit(f"{what}: expected 1 match, found {s.count(old)}")
    s = s.replace(old, new)
write(CLIENT.replace(OLD_CHUNK, NEW_CHUNK), s)

m = (app / MANIFEST).read_text()
# listed both as "/_next/static/chunks/<name>.js" (client references) and "static/chunks/<name>.js" (entry files)
if m.count(f"static/chunks/{OLD_CHUNK}.js") < 2:
    sys.exit("manifest: chunk references not found")
write(MANIFEST, m.replace(f"static/chunks/{OLD_CHUNK}.js", f"static/chunks/{NEW_CHUNK}.js"))
