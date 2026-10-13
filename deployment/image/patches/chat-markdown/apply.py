"""Patch the built portal so assistant replies render Markdown (tables, lists, headings, code, links).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release> <out dir>
Writes the patched browser chunk (under a new name, so browsers do not reuse the cached old one),
the SSR chunk and the chat page's client manifest into <out dir>, mirroring their paths under /app.
"""
import pathlib
import sys

OLD_CHUNK = "1ftcf9r3odi0s"
NEW_CHUNK = "1ftcf9r3odi0s-md1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
SSR = ".next/server/chunks/ssr/src_components_chat-view_tsx_1l5qao6._.js"
MANIFEST = ".next/server/app/(app)/chat/[id]/page_client-reference-manifest.js"

here = pathlib.Path(__file__).parent
app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
helper = (here / "markdown.js").read_text()


def replace_once(s, old, new, what):
    if s.count(old) != 1:
        sys.exit(f"{what}: expected 1 match, found {s.count(old)}")
    return s.replace(old, new)


def patch_chat(s, msg, jsx, row_fn, what):
    # Old renderer: blank-line paragraphs with **bold** only. Its loop variable names differ per build output.
    old = (
        f'{msg}.text.split("\\n\\n").filter(Boolean).map(({{p}},{{i}})=>(0,{jsx}.jsx)("p",{{{{children:{{p}}.split(/(\\*\\*[^*]+\\*\\*)/g)'
        f'.map(({{p}},{{j}})=>{{p}}.startsWith("**")&&{{p}}.endsWith("**")&&{{p}}.length>4?(0,{jsx}.jsx)("strong",{{{{className:"font-semibold",children:{{p}}.slice(2,-2)}}}},{{j}}):{{p}})}}}},{{i}}))'
    )
    for p, i, j in (("e", "a", "a"), ("a", "c", "c")):
        candidate = old.format(p=p, i=i, j=j)
        if candidate in s:
            s = replace_once(s, candidate, f"__digiMd({msg}.text,{jsx}.jsx)", what + " renderer")
            break
    else:
        sys.exit(f"{what}: old renderer not found")
    return replace_once(s, f"function {row_fn}({{m:{msg},", helper + f"function {row_fn}({{m:{msg},", what + " row")


def write(rel, text):
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print("wrote", dest)


write(CLIENT.replace(OLD_CHUNK, NEW_CHUNK), patch_chat((app / CLIENT).read_text(), "e", "t", "E", "client chunk"))
write(SSR, patch_chat((app / SSR).read_text(), "a", "b", "M", "ssr chunk"))
m = (app / MANIFEST).read_text()
# listed both as "/_next/static/chunks/<name>.js" (client references) and "static/chunks/<name>.js" (entry files)
if m.count(f"static/chunks/{OLD_CHUNK}.js") < 2:
    sys.exit("manifest: chunk references not found")
write(MANIFEST, m.replace(f"static/chunks/{OLD_CHUNK}.js", f"static/chunks/{NEW_CHUNK}.js"))
