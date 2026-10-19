# Patch: a room search names every preference it could not meet (QA DEF-14)

`digiworks-portal.tar.gz` includes this patch (on top of `booking-form-validation`). To reproduce it: extract `/app/.next` from the image **with the earlier patches applied**, run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** search for a room in Eck Hall with a Projector when no free room has one: the note says only "Nothing free matches everything you asked for (Projector)", so it is not clear the building was given up too and the rooms shown may be elsewhere.

**Cause:** `searchRooms` (`src/lib/rooms.ts`) loosens preferences one at a time (room size, then building, then equipment). Its last step drops both the building and the equipment, but its note named only the equipment.

**Fix:** when a building was asked for, the last step's note names it too: "Nothing free in Eck Hall or any other building matches everything you asked for (Projector). These are free and fit your group, but may be in other buildings, so check the equipment with staff." Without a building the note is unchanged. The other steps already said what they loosened.

`searchRooms` is compiled into five server chunks (the request form's search API, Digi's room tools and page renders); all are patched. Server chunks are not cached by browsers, so they keep their names and no manifest changes.

**Tested** on a local copy with one room in Eck Hall and one in BGSC, neither with a projector: Eck Hall + Projector shows the new note listing both rooms; the same search with no building preference shows the old note.

**Fix in the portal source** (apply there so the next build keeps it): `rooms.ts` here is the fixed `src/lib/rooms.ts`; `rooms.diff` is the change.
