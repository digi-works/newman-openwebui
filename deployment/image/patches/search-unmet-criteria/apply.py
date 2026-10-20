"""Patch the built portal so a room search that loosened both the building and the equipment names both (QA DEF-14).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release, with the earlier patches applied> files
Writes every server chunk that contains searchRooms (the form's search API, Digi's room tools and the page renders)
into files/, mirroring their paths under /app. Server chunks are never cached by browsers, so they keep their names.
"""
import pathlib
import re
import sys

app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

# the last relaxation step's note; the minifier names the query (q) and the needs list (n) differently per chunk
OLD = re.compile(
    r'note:(\w)\.building\?`Nothing free in \$\{\1\.building\}, so these are in other buildings\.`:""\},'
    r'\{o:\{size:!1,building:!1,needs:!1\},note:`Nothing free matches everything you asked for'
    r'\$\{(\w)\.length\?` \(\$\{\2\.join\(", "\)\}\)`:""\}\. These are free and fit your group, so check the equipment with staff\.`\}')


def new(m):
    q, n = m.group(1), m.group(2)
    listed = f'${{{n}.length?` (${{{n}.join(", ")}})`:""}}'
    return (f'note:{q}.building?`Nothing free in ${{{q}.building}}, so these are in other buildings.`:""}},'
            f'{{o:{{size:!1,building:!1,needs:!1}},note:{q}.building'
            f'?`Nothing free in ${{{q}.building}} or any other building matches everything you asked for{listed}. These are free and fit your group, but may be in other buildings, so check the equipment with staff.`'
            f':`Nothing free matches everything you asked for{listed}. These are free and fit your group, so check the equipment with staff.`}}')


found = 0
for path in sorted((app / ".next/server").rglob("*.js")):
    s = path.read_text()
    if "Nothing free matches everything you asked for" not in s:
        continue
    t, k = OLD.subn(new, s)
    if k != 1:
        sys.exit(f"{path.relative_to(app)}: expected 1 match, found {k}")
    dest = out / path.relative_to(app)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(t)
    print("wrote", dest)
    found += 1
if not found:
    sys.exit("no chunk contains searchRooms")
