"""Patch the built portal so the Approvals page no longer reads as "nothing to decide" while room requests are waiting (QA DEF-02).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release> files
Writes into files/, mirroring paths under /app:
- the Approvals page's server code: when room requests are waiting and the person may approve them, a box at the top says how many
  and links to Bookings, where they are decided (same count as the bell)
- the Approvals view, browser chunk (renamed so browsers do not reuse the cached old file) and server-render chunk: the empty message
  says what this page holds ("No actions are waiting for a second person's approval.") instead of "Nothing is waiting for a decision."
- the page's client manifest, pointing at the renamed chunk
"""
import pathlib
import sys

OLD_CHUNK = "167s8qzpp8cyo"
NEW_CHUNK = "167s8qzpp8cyo-rooms1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
SSR = ".next/server/chunks/ssr/_1lsy4ma._.js"
PAGE = ".next/server/chunks/ssr/[root-of-the-server]__1nkfd9z._.js"
MANIFEST = ".next/server/app/(app)/approvals/page_client-reference-manifest.js"

OLD_EMPTY = "Nothing is waiting for a decision."
NEW_EMPTY = "No actions are waiting for a second person's approval."

# The page component, as built from src/app/(app)/approvals/page.tsx. Module 78620 is booking-service (pendingCount, the bell's count);
# it is an async module, so it joins the page's awaited dependencies. 82241 is session (can), 43975 permissions (P).
OLD_PAGE = (
    "var e=a.i(73727),f=a.i(47488),g=a.i(45660),h=a.i(43975),i=a.i(82241),j=b([g,i]);async function k(){"
    "let a=await (0,i.requirePermission)(h.P.approvalsDecide);a||(0,e.redirect)(\"/\");let b=(0,i.authLive)()?await (0,g.listPending)(a):[];"
    "return(0,d.jsx)(\"div\",{className:\"p-4 md:p-8\",children:(0,d.jsx)(f.ApprovalsView,{initial:b})})}[g,i]=j.then?(await j)():j,"
)
NEW_PAGE = (
    "var e=a.i(73727),f=a.i(47488),g=a.i(45660),h=a.i(43975),i=a.i(82241),__bs=a.i(78620),j=b([g,i,__bs]);async function k(){"
    "let a=await (0,i.requirePermission)(h.P.approvalsDecide);a||(0,e.redirect)(\"/\");let b=(0,i.authLive)()?await (0,g.listPending)(a):[];"
    "let __n=(0,i.authLive)()&&(0,i.can)(a,h.P.bookingsApprove)?await (0,__bs.pendingCount)(a.tenantId).catch(()=>0):0;"
    "return(0,d.jsxs)(\"div\",{className:\"p-4 md:p-8\",children:[__n>0&&(0,d.jsxs)(\"div\",{role:\"status\",className:\"mx-auto mb-6 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-4\",children:["
    "(0,d.jsxs)(\"div\",{className:\"text-sm\",children:[(0,d.jsx)(\"div\",{className:\"font-medium\",children:`${__n} room ${1===__n?\"request is\":\"requests are\"} waiting for a decision`}),"
    "(0,d.jsx)(\"div\",{className:\"text-muted-foreground\",children:\"Room requests are approved or declined on the Bookings page, not here.\"})]}),"
    "(0,d.jsx)(\"a\",{href:\"/bookings\",className:\"shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80\",children:\"Review room requests\"})]}),"
    "(0,d.jsx)(f.ApprovalsView,{initial:b})]})}[g,i,__bs]=j.then?(await j)():j,"
)

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])


def replace_once(s, old, new, what):
    if s.count(old) != 1:
        sys.exit(f"{what}: expected 1 match, found {s.count(old)}")
    return s.replace(old, new)


def write(rel, text):
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print("wrote", dest)


write(PAGE, replace_once((app / PAGE).read_text(), OLD_PAGE, NEW_PAGE, "approvals page"))
write(SSR, replace_once((app / SSR).read_text(), OLD_EMPTY, NEW_EMPTY, "ssr chunk"))
write(CLIENT.replace(OLD_CHUNK, NEW_CHUNK), replace_once((app / CLIENT).read_text(), OLD_EMPTY, NEW_EMPTY, "client chunk"))
m = (app / MANIFEST).read_text()
# listed both as "/_next/static/chunks/<name>.js" (client references) and "static/chunks/<name>.js" (entry files)
if m.count(f"static/chunks/{OLD_CHUNK}.js") < 2:
    sys.exit("manifest: chunk references not found")
write(MANIFEST, m.replace(f"static/chunks/{OLD_CHUNK}.js", f"static/chunks/{NEW_CHUNK}.js"))
