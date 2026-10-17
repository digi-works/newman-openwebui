"""Patch the built portal so "Reset password" in Settings > Users can no longer lock someone out with one click (QA DEF-27).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release, earlier patches applied> files
- Reset password asks first: the row shows "Reset the password for <name>? They will be signed out." with Yes, reset / Cancel.
- It is not offered on your own row (as Disable already is not); your own password is changed under Settings > Account.
- The server refuses a reset of your own account too (PATCH /api/admin/users/<own id>), so the button is not the only guard.
Patched: the Users screen's browser chunk (renamed so browsers do not reuse the cached old file; the manifest is updated) and its
server-render chunk, which must match; and both server copies of updateUser (src/lib/admin-users.ts).
"""
import pathlib
import sys

OLD_CHUNK = "181nyvs65jtp2"
NEW_CHUNK = "181nyvs65jtp2-confirm1"
CLIENT = f".next/static/chunks/{OLD_CHUNK}.js"
SSR = ".next/server/chunks/ssr/_1y0hugl._.js"
MANIFEST = ".next/server/app/(app)/settings/users/page_client-reference-manifest.js"
SERVER = [".next/server/chunks/[root-of-the-server]__1-x-q_d._.js", ".next/server/chunks/[root-of-the-server]__1gbob8v._.js"]


def screen(jsx, react, button, row, self_id, busy, can, act, last_state):
    """Edits for one copy of UsersAdmin; the names are the minified ones in that copy."""
    state_old = f"{last_state}=(0,{react}.useState)(!1);"
    state_new = f"{last_state}=(0,{react}.useState)(!1),[__cf,__setCf]=(0,{react}.useState)(null);"
    btn_old = (f'{can}.update&&(0,{jsx}.jsx)({button}.Button,{{size:"sm",variant:"outline",disabled:null!=={busy}||{row}.role.includes("Admin")&&!{can}.giveAdmin,'
               f'onClick:()=>{act}({row},"reset_password"),children:"Reset password"}})')
    btn_new = (f'{can}.update&&{row}.id!=={self_id}&&(__cf==={row}.id?(0,{jsx}.jsxs)("span",{{className:"flex flex-wrap items-center justify-end gap-2",children:['
               f'(0,{jsx}.jsx)("span",{{className:"text-xs text-muted-foreground",children:`Reset the password for ${{{row}.name}}? They will be signed out.`}}),'
               f'(0,{jsx}.jsx)({button}.Button,{{size:"sm",variant:"destructive",disabled:null!=={busy},onClick:()=>{{__setCf(null),{act}({row},"reset_password")}},children:"Yes, reset"}}),'
               f'(0,{jsx}.jsx)({button}.Button,{{size:"sm",variant:"outline",disabled:null!=={busy},onClick:()=>__setCf(null),children:"Cancel"}})]}})'
               f':(0,{jsx}.jsx)({button}.Button,{{size:"sm",variant:"outline",disabled:null!=={busy}||{row}.role.includes("Admin")&&!{can}.giveAdmin,'
               f'onClick:()=>__setCf({row}.id),children:"Reset password"}}))')
    return [("state", state_old, state_new), ("button", btn_old, btn_new)]


SELF_OLD = 'if(t===e.id&&["disable","set_role"].includes(r.action))return{error:"You cannot disable or change the role of your own account.",status:400};'
SELF_NEW = SELF_OLD + 'if(t===e.id&&"reset_password"===r.action)return{error:"Change your own password under Settings > Account.",status:400};'

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])


def patch(rel, dest_rel, edits):
    s = (app / rel).read_text()
    for what, old, new in edits:
        if s.count(old) != 1:
            sys.exit(f"{rel} ({what}): expected 1 match, found {s.count(old)}")
        s = s.replace(old, new)
    dest = out / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(s)
    print("wrote", dest)


patch(CLIENT, CLIENT.replace(OLD_CHUNK, NEW_CHUNK), screen("s", "a", "m", "e", "d", "g", "x", "A", "[N,w]"))
patch(SSR, SSR, screen("b", "d", "l", "a", "i", "q", "n", "A", "[w,x]"))
for rel in SERVER:
    patch(rel, rel, [("self reset", SELF_OLD, SELF_NEW)])
m = (app / MANIFEST).read_text()
# listed both as "/_next/static/chunks/<name>.js" (client references) and "static/chunks/<name>.js" (entry files)
if m.count(f"static/chunks/{OLD_CHUNK}.js") < 2:
    sys.exit("manifest: chunk references not found")
dest = out / MANIFEST
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(m.replace(f"static/chunks/{OLD_CHUNK}.js", f"static/chunks/{NEW_CHUNK}.js"))
print("wrote", dest)
