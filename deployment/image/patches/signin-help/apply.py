"""Patch the built portal: the sign-in page says how to recover a password, and a signed-out API call gets 401 "Please sign in." (QA DEF-30).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release, with the earlier patches applied> files
Writes into files/, mirroring their paths under /app:
- the request proxy's server chunk (patched in place; server code is not cached by browsers),
- the login form's browser chunk (renamed so browsers do not reuse the cached old one) and the /login client manifest,
- the login form's server-render chunk, which must match the browser one (the new link is in the first render).
"""
import pathlib
import re
import sys

PROXY = ".next/server/chunks/[root-of-the-server]__0gqyn5_._.js"
OLD_CHUNK = "2pxazq6kpdrl0"
NEW_CHUNK = "2pxazq6kpdrl0-forgot1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
SSR = ".next/server/chunks/ssr/_1iumdsg._.js"
MANIFEST = ".next/server/app/login/page_client-reference-manifest.js"

HELP_CLASS = "rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground"
LINK_CLASS = "text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])


def write(rel, text):
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print("wrote", dest)


def sub1(rx, rep, s, what):
    s, k = re.subn(rx, rep, s)
    if k != 1:
        sys.exit(f"{what}: expected 1 match, found {k}")
    return s


# --- proxy: signed out -> 401, except sign-in, the internal API and the platform's own APIs ---
GUARD = 'if(rv.has(e.method)||e.nextUrl.pathname.startsWith("/api/internal/"))'
s = (app / PROXY).read_text()
if s.count(GUARD) != 1:
    sys.exit("proxy: guard not found")
s = s.replace(GUARD, 'if(e.nextUrl.pathname.startsWith("/api/")&&!/^\\/api\\/(auth|internal|platform|release)(\\/|$)/.test(e.nextUrl.pathname)'
                     '&&!e.cookies.get("digi_session")?.value)return rm.NextResponse.json({error:"Please sign in."},{status:401});' + GUARD)
write(PROXY, s)

# --- room search and room request APIs: an expired session gets 401 "Please sign in again.", not "Your role cannot ..." ---
ROUTES = [".next/server/chunks/_16zqt-9._.js",  # /api/rooms/search
          ".next/server/chunks/_0c3ym06._.js"]  # /api/bookings (POST, request a room)
for rel in ROUTES:
    s = sub1(r'=await \(0,(\w+)\.requirePermission\)\((\w+)\.P\.bookingsCreate\);if\(!(\w+)\)return (\w+)\("Your role cannot request rooms\.",403\);',
             lambda m: (f'=await (0,{m[1]}.requirePermission)({m[2]}.P.bookingsCreate);if(!{m[3]})return await (0,{m[1]}.getSessionUser)()'
                        f'?{m[4]}("Your role cannot request rooms.",403):{m[4]}("Please sign in again.",401);'),
             (app / rel).read_text(), rel)
    write(rel, s)


# --- login form: "Forgot password?" shows how to get back in ---
def login(s):
    org = re.findall(r'children:\["Use your ",(\w+)," account to continue"\]', s)
    if len(org) != 1:
        sys.exit("login: org not found")
    org = org[0]
    s = sub1(r'(\[\w+,\w+\]=\(0,(\w+)\.useState\)\(""\));async function', r'\1,[__fg,__setFg]=(0,\2.useState)(!1);async function', s, "login state")

    def block(m):
        j, inp = m[1], m[2]
        return (f'(0,{j}.jsxs)("div",{{className:"flex items-center justify-between",children:['
                f'(0,{j}.jsx)("label",{{htmlFor:"password",className:"text-sm font-medium",children:"Password"}}),'
                f'(0,{j}.jsx)("button",{{type:"button","aria-expanded":__fg,onClick:()=>__setFg(v=>!v),className:"{LINK_CLASS}",children:"Forgot password?"}})]}}),'
                f'{inp}]}}),__fg&&(0,{j}.jsxs)("p",{{role:"status",className:"{HELP_CLASS}",children:["Ask an Admin at ",{org},'
                f'" to reset it under Settings > Users. They will give you a temporary password, and you choose a new one when you sign in. '
                f'If no Admin can sign in, your IT team can reset it on the server."]}})')

    return sub1(r'\(0,(\w+)\.jsx\)\("label",\{htmlFor:"password",className:"text-sm font-medium",children:"Password"\}\),'
                r'(\(0,\1\.jsx\)\(\w+\.Input,\{id:"password",[^}]*\}\))\]\}\)', block, s, "login password block")


write(CLIENT.replace(OLD_CHUNK, NEW_CHUNK), login((app / CLIENT).read_text()))
write(SSR, login((app / SSR).read_text()))

m = (app / MANIFEST).read_text()
# listed both as "/_next/static/chunks/<name>.js" (client references) and "static/chunks/<name>.js" (entry files)
if m.count(f"static/chunks/{OLD_CHUNK}.js") < 2:
    sys.exit("manifest: chunk references not found")
write(MANIFEST, m.replace(f"static/chunks/{OLD_CHUNK}.js", f"static/chunks/{NEW_CHUNK}.js"))
