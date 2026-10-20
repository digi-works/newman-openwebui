"""Patch the built portal so cancelling a room request or booking asks first (Jira WOR-142).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release, earlier patches applied> files
In the booking details panel, "Cancel request" (a waiting request) and "Cancel booking" (a confirmed one, by its requester or by an
approver with a reason) cancelled on the first click. Now the first click asks "Cancel this ...? This cannot be undone." with
"Yes, cancel ..." and "Keep it"; only "Yes" cancels. The panel only renders after a click, so only the browser chunk changes: the
bookings view chunk as already patched by bookings-reference (45b5nwileyx2a-ref1.js), renamed so browsers do not reuse the cached
copy, and the /bookings manifest updated.
"""
import pathlib
import sys

OLD_CHUNK = "45b5nwileyx2a-ref1"
NEW_CHUNK = "45b5nwileyx2a-cancel1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
MANIFEST = ".next/server/app/(app)/bookings/page_client-reference-manifest.js"

SPIN = '"cancel"===R&&(0,t.jsx)(o.Loader2,{className:"animate-spin"})'
KEEP = '(0,t.jsx)(u.Button,{variant:"outline",disabled:!!R,onClick:()=>__setCc(!1),children:"Keep it"})'

# Booking panel (Body in booking-dialog.tsx): A/L = error state, E = cancel, M = call, R = busy, a = abilities, m = own booking
EDITS = [
    ("state", '[A,L]=(0,r.useState)(""),z=Math.min(', '[A,L]=(0,r.useState)(""),[__cc,__setCc]=(0,r.useState)(!1),z=Math.min('),
    # first press (after the reason check) only asks; the second press cancels
    ("cancel", 'm||p.trim()?M("cancel",`/api/bookings/${e.id}/cancel`,"POST",{reason:p},`${e.room} cancelled.`):L(',
     'm||p.trim()?__cc?(__setCc(!1),M("cancel",`/api/bookings/${e.id}/cancel`,"POST",{reason:p},`${e.room} cancelled.`)):__setCc(!0):L('),
    ("cancel request button",
     f'a.cancel&&(0,t.jsxs)(u.Button,{{variant:"outline",disabled:!!R,onClick:E,children:[{SPIN}," Cancel request"]}})',
     f'a.cancel&&(0,t.jsxs)(u.Button,{{variant:__cc?"destructive":"outline",disabled:!!R,onClick:E,children:[{SPIN},__cc?" Yes, cancel request":" Cancel request"]}}),'
     f'a.cancel&&__cc&&{KEEP},a.cancel&&__cc&&(0,t.jsx)("p",{{className:"w-full text-sm text-muted-foreground",children:"Cancel this request? This cannot be undone."}})'),
    ("cancel booking button",
     f'(0,t.jsxs)(u.Button,{{variant:"outline",className:"mt-4",disabled:!!R,onClick:E,children:[{SPIN}," Cancel booking"]}})',
     f'__cc&&(0,t.jsx)("p",{{className:"mt-3 text-sm text-muted-foreground",children:"Cancel this booking? This cannot be undone."}}),'
     f'(0,t.jsxs)("div",{{className:"mt-4 flex flex-wrap gap-2",children:[(0,t.jsxs)(u.Button,{{variant:__cc?"destructive":"outline",disabled:!!R,onClick:E,children:[{SPIN},__cc?" Yes, cancel booking":" Cancel booking"]}}),__cc&&{KEEP}]}})'),
]

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])


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
