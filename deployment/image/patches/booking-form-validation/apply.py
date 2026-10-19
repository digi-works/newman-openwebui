"""Patch the built portal so the room request form says what is wrong with it, in the form, instead of only the browser's passing bubble (QA DEF-13).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release, with booking-stale-results applied> files
Writes the patched browser chunk (under a new name, so browsers do not reuse the cached old one) and the
/bookings/new page's client manifest into files/, mirroring their paths under /app. The server-render chunk
needs no change: the form first renders with no problems, which looks the same as before.
"""
import pathlib
import sys

OLD_CHUNK = "0eamtwqza3ecy-stale1"
NEW_CHUNK = "0eamtwqza3ecy-valid1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
MANIFEST = ".next/server/app/(app)/bookings/new/page_client-reference-manifest.js"

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

# c is the today prop, t the FormData in the search handler, __clr the stale-results clear from booking-stale-results
CHECK = ('__chk=__f=>{let v=k=>String(__f.get(k)??"").trim(),p={};'
         'v("purpose")||(p.purpose="Say what the booking is for.");'
         'v("date")?v("date")<c&&(p.date="Pick today or a later date."):p.date="Pick a date.";'
         'v("start")||(p.start="Set a start time.");'
         'v("end")?v("start")&&v("end")<=v("start")&&(p.end="The end time must be after the start time."):p.end="Set an end time.";'
         'let n=Number(v("people"));(!v("people")||!Number.isInteger(n)||n<1||n>500)&&(p.people="Say how many people, from 1 to 500.");return p}')

# (what, old, new): each old text must occur exactly once in the chunk
EDITS = [
    # state: the problems by field, the check that finds them, and whether a field is one of them
    ("state", "__clr=()=>{g&&(j(null),__setSt(!0))};async function N(e){",
     "__clr=()=>{g&&(j(null),__setSt(!0))},[__pb,__setPb]=(0,a.useState)({})," + CHECK + ",__bad=k=>__pb[k]?!0:void 0;async function N(e){"),
    # search: check every field; a search that cannot run also removes old results (QA DEF-12)
    ("search", 'if(!s.purpose)return void f("Say what the booking is for.");',
     "{let __p=__chk(t);if(__setPb(__p),Object.keys(__p).length)return void __clr()}"),
    # no browser bubble; once problems show, they update as the person edits. noValidate is set through a ref because the
    # server-rendered form (unchanged chunk) has no novalidate attribute and hydration does not add one
    ("form", '(0,t.jsxs)("form",{onSubmit:N,onChange:__clr,onInvalidCapture:__clr,',
     '(0,t.jsxs)("form",{noValidate:!0,ref:e=>{e&&(e.noValidate=!0)},onSubmit:N,onChange:e=>{__clr(),Object.keys(__pb).length&&__setPb(__chk(new FormData(e.currentTarget)))},'),
    # the problem list, above the server's own error
    ("alert", 'h&&(0,t.jsx)("p",{role:"alert",',
     'Object.keys(__pb).length>0&&(0,t.jsx)("div",{role:"alert",className:"rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive",'
     'children:Object.values(__pb).map(e=>(0,t.jsx)("p",{children:e},e))}),h&&(0,t.jsx)("p",{role:"alert",'),
] + [
    # mark the field itself (the Input turns red when aria-invalid)
    (k, f'(d.Input,{{id:"{k}",', f'(d.Input,{{"aria-invalid":__bad("{k}"),id:"{k}",')
    for k in ("purpose", "date", "start", "end", "people")
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
