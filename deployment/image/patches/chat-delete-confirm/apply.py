"""Patch the built portal so deleting a chat on History asks first (QA DEF-29).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release, with the earlier patches applied> files
Writes the patched browser chunk (under a new name, so browsers do not reuse the cached old one) and the /history page's
client manifest into files/, mirroring their paths under /app. The server-render chunk needs no change: the server renders
loading placeholders, and the chat rows (with the delete control) only appear in the browser.
"""
import pathlib
import sys

OLD_CHUNK = "3qaeeclzx3r-g"
NEW_CHUNK = "3qaeeclzx3r-g-del1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
MANIFEST = ".next/server/app/(app)/history/page_client-reference-manifest.js"

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

TIME = '(0,t.jsx)("time",{className:"text-xs text-muted-foreground",children:(0,d.timeLabel)(e.updatedAt)})'
TRASH = ('(0,t.jsx)(l.Button,{variant:"ghost",size:"icon-sm",className:"relative z-10 opacity-0 focus-visible:opacity-100 group-hover:opacity-100",'
         '"aria-label":`Delete ${e.title}`,onClick:()=>%s,children:(0,t.jsx)(i.Trash2,{})})')
CONFIRM = ('(0,t.jsxs)("div",{className:"relative z-10 flex items-center gap-2",children:['
           '(0,t.jsx)("span",{className:"hidden text-xs text-muted-foreground sm:inline",children:"Delete this chat? This cannot be undone."}),'
           '(0,t.jsx)(l.Button,{size:"sm",variant:"destructive","aria-label":`Yes, delete ${e.title}`,onClick:()=>{__setCf(null),(0,d.deleteChat)(e.id)},children:"Yes, delete"}),'
           '(0,t.jsx)(l.Button,{size:"sm",variant:"outline",autoFocus:!0,onClick:()=>__setCf(null),children:"Keep it"})]})')

# (what, old, new): each old text must occur exactly once in the chunk
EDITS = [
    # which row is asking "Delete this chat?"
    ("state", '[x,v]=(0,s.useState)(""),', '[x,v]=(0,s.useState)(""),[__cf,__setCf]=(0,s.useState)(null),'),
    # the trash button only asks; the row then offers "Yes, delete" (deletes) and "Keep it"
    ("row", TIME + "," + TRASH % "(0,d.deleteChat)(e.id)",
     f"__cf===e.id?{CONFIRM}:(0,t.jsxs)(t.Fragment,{{children:[{TIME},{TRASH % '__setCf(e.id)'}]}})"),
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
