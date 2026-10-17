"""Patch the built portal so the sidebar's Help button does something: it opens a new chat with Digi (QA DEF-20).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release> files
Help was a SidebarMenuButton with no action (src/components/app-sidebar.tsx). It now starts a chat with Digi that opens with
"What can you help me with in Ask Digi?", the same way the sidebar's New chat starts one. Only the browser chunk changes (a click
handler does not change the server-rendered HTML); it is renamed so browsers do not reuse the cached old file, and every page manifest
that lists it is updated (the sidebar is on every page).
"""
import pathlib
import sys

OLD_CHUNK = "3i-29vktforvc"
NEW_CHUNK = "3i-29vktforvc-help1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
PROMPT = "What can you help me with in Ask Digi?"

# l is the router and q the chat store in AppSidebar, exactly as the New chat button uses them
OLD = '(0,t.jsxs)(D.SidebarMenuButton,{tooltip:"Help",children:'
NEW = f'(0,t.jsxs)(D.SidebarMenuButton,{{tooltip:"Help",onClick:async()=>l.push(`/chat/${{await (0,q.createChat)("digi","{PROMPT}")}}`),children:'
NEW_CHAT = 'onClick:async()=>l.push(`/chat/${await (0,q.createChat)("digi")}`)'

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])


def write(rel, text):
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print("wrote", dest)


s = (app / CLIENT).read_text()
if s.count(OLD) != 1 or s.count(NEW_CHAT) != 1:
    sys.exit(f"client chunk: expected the Help button and New chat once each, found {s.count(OLD)} and {s.count(NEW_CHAT)}")
write(CLIENT.replace(OLD_CHUNK, NEW_CHUNK), s.replace(OLD, NEW))

manifests = [p for p in (app / ".next/server").rglob("*_client-reference-manifest.js") if f"static/chunks/{OLD_CHUNK}.js" in p.read_text()]
if not manifests:
    sys.exit("no manifest lists the chunk")
for p in manifests:
    m = p.read_text()
    write(str(p.relative_to(app)), m.replace(f"static/chunks/{OLD_CHUNK}.js", f"static/chunks/{NEW_CHUNK}.js"))
print(len(manifests), "manifests updated")
