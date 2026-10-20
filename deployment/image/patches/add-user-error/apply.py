"""Patch the built portal so the Add user form's error clears once the form is edited (QA DEF-31).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release, with the earlier patches applied> files
Builds on the Users chunk from reset-password-confirm. Writes the patched browser chunk (under a new name, so browsers do
not reuse the cached old one) and the /settings/users client manifest into files/. The server-render chunk is unchanged:
the form only appears after Add user is clicked, and the button's markup does not change.
"""
import pathlib
import sys

OLD_CHUNK = "181nyvs65jtp2-confirm1"
NEW_CHUNK = "181nyvs65jtp2-adderr1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
MANIFEST = ".next/server/app/(app)/settings/users/page_client-reference-manifest.js"

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

# y is setError (from [f,y]=(0,a.useState)(""), f being the error shown in the alert)
EDITS = [
    ("error state", '[f,y]=(0,a.useState)("")', '[f,y]=(0,a.useState)("")'),
    # opening or closing Add user starts afresh
    ("add button", '(m.Button,{onClick:()=>w(e=>!e),children:', '(m.Button,{onClick:()=>{w(e=>!e),y("")},children:'),
    # editing any field clears the old error, so it always describes the current input
    ("form", '("form",{onSubmit:C,className:', '("form",{onSubmit:C,onChange:()=>y(""),className:'),
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
