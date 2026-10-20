import type { Room } from "../rooms";

/**
 * The room request form and the list of free rooms, as small self-contained pages Digi shows in the conversation (in a sandboxed frame). They are built
 * here so any runtime can show them: the Open WebUI tool modules build their own copy, and the Strands runtime gets these from the tool gateway as an
 * "embed" event. Both talk to the page the same way (postMessage), so the chat view needs no change.
 */
const FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">';
const CSS = `
* { box-sizing: border-box; }
body { margin: 0; padding: 4px; font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #11204b; background: transparent; }
.card { border: 1px solid #e3e7ee; border-radius: 18px; overflow: hidden; background: #fff; max-width: 900px; }
.head { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; background: #f7f9fc; border-bottom: 1px solid #e3e7ee; }
.head b { font-size: 17px; font-weight: 600; } .head span { font-size: 14px; color: #6b7690; }
.body { padding: 22px 24px 24px; }
label { display: block; font-size: 14px; font-weight: 500; margin: 0 0 8px; color: #28345a; }
input, select { width: 100%; height: 46px; padding: 0 14px; border: 1px solid #d8deea; border-radius: 12px; font: inherit; font-size: 15px; color: #11204b; background: #fff; }
input:focus, select:focus, button:focus-visible { outline: 3px solid rgba(17, 32, 75, .18); border-color: #11204b; }
.row { display: grid; gap: 16px; margin-bottom: 18px; } .r3 { grid-template-columns: 1.1fr 1fr 1fr; } .r2 { grid-template-columns: 1fr 1fr; }
.chips { display: flex; flex-wrap: wrap; gap: 10px; }
.chip { border: 1px solid #d8deea; background: #fff; color: #28345a; border-radius: 999px; padding: 9px 18px; font: inherit; font-size: 14px; cursor: pointer; }
.chip[aria-pressed="true"] { background: #11204b; border-color: #11204b; color: #fff; }
.foot { display: flex; justify-content: flex-end; border-top: 1px solid #eceff5; margin-top: 22px; padding-top: 20px; }
.primary { border: 0; border-radius: 12px; padding: 13px 24px; font: inherit; font-size: 15px; font-weight: 500; cursor: pointer; background: #11204b; color: #fff; }
.primary:disabled { background: #dfe3ec; color: #fff; cursor: not-allowed; }
.ghost { border: 1px solid #d8deea; background: #fff; color: #11204b; border-radius: 12px; padding: 10px 18px; font: inherit; font-size: 14px; cursor: pointer; }
.list { padding: 8px 24px 20px; } .item { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid #eceff5; }
.item:last-child { border-bottom: 0; } .sub { font-size: 13px; color: #6b7690; margin-top: 4px; } .pick { padding: 10px 16px; font-size: 14px; }
@media (max-width: 640px) { .r3, .r2 { grid-template-columns: 1fr; } }`;
const HEIGHT_JS = `function reportHeight() { parent.postMessage({ type: "iframe:height", height: document.documentElement.scrollHeight }, "*"); }
window.addEventListener("load", reportHeight); if (window.ResizeObserver) { new ResizeObserver(reportHeight).observe(document.body); }`;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const page = (body: string, script: string) => `<!DOCTYPE html><html><head><meta charset="utf-8">${FONT}<style>${CSS}</style></head><body>${body}<script>${script}${HEIGHT_JS}</script></body></html>`;

export function roomFormEmbed(buildings: string[], needs: string[]): string {
  const options = buildings.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
  const chips = needs.map((n) => `<button type="button" class="chip" aria-pressed="false" data-need="${esc(n)}">${esc(n)}</button>`).join("");
  const body = `
<div class="card"><div class="head"><b>Room request</b><span>Step 1 of 2</span></div>
  <form id="f" class="body" novalidate>
    <div class="row"><div><label for="purpose">What is the booking for?</label><input id="purpose" maxlength="120" placeholder="e.g. Book club discussion" autocomplete="off"></div></div>
    <div class="row r3"><div><label for="date">Date</label><input id="date" type="date"></div><div><label for="start">Start</label><input id="start" type="time"></div><div><label for="end">End</label><input id="end" type="time"></div></div>
    <div class="row r2">
      <div><label for="people">How many people?</label><div style="position:relative"><input id="people" type="number" min="1" max="500" value="12">
        <div style="position:absolute;right:8px;top:7px;display:flex;gap:6px"><button type="button" class="ghost" id="minus" style="padding:4px 12px" aria-label="Fewer people">&minus;</button><button type="button" class="ghost" id="plus" style="padding:4px 12px" aria-label="More people">+</button></div></div></div>
      <div><label for="building">Preferred building</label><select id="building"><option value="">No preference</option>${options}</select></div>
    </div>
    <div class="row" style="margin-bottom:0"><div><label>Anything the room needs?</label><div class="chips">${chips}</div></div></div>
    <div class="foot"><button type="submit" class="primary" id="go" disabled>Find Available Rooms</button></div>
  </form></div>`;
  const script = String.raw`
const $ = (id) => document.getElementById(id);
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
$("date").min = today;
const needs = new Set();
function valid() {
  const ok = $("purpose").value.trim() && $("date").value >= today && $("start").value && $("end").value && $("end").value > $("start").value && Number($("people").value) >= 1;
  $("go").disabled = !ok;
}
["purpose", "date", "start", "end", "people"].forEach((i) => $(i).addEventListener("input", valid));
$("minus").onclick = () => { $("people").value = Math.max(1, Number($("people").value || 1) - 1); valid(); };
$("plus").onclick = () => { $("people").value = Math.min(500, Number($("people").value || 0) + 1); valid(); };
document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
  const on = c.getAttribute("aria-pressed") !== "true";
  c.setAttribute("aria-pressed", String(on));
  on ? needs.add(c.dataset.need) : needs.delete(c.dataset.need);
}));
const submitForm = (e) => {
  e.preventDefault();
  if ($("go").disabled) return;
  const data = { purpose: $("purpose").value.trim(), date: $("date").value, start_time: $("start").value, end_time: $("end").value,
    people: Number($("people").value), building: $("building").value, needs: Array.from(needs) };
  const text = "Find me an available room.\nPurpose: " + data.purpose + "\nDate: " + data.date + "\nTime: " + data.start_time + " to " + data.end_time +
    "\nPeople: " + data.people + "\nBuilding: " + (data.building || "No preference") + "\nNeeds: " + (data.needs.join(", ") || "None") +
    "\n\n<!--room-request " + JSON.stringify(data) + "-->";
  $("go").disabled = true; $("go").textContent = "Searching...";
  parent.postMessage({ type: "input:prompt:submit", text }, "*");
};
$("f").addEventListener("submit", submitForm);
$("go").addEventListener("click", submitForm);
valid();`;
  return page(body, script);
}

export function roomResultsEmbed(rooms: Room[], note: string, query: { purpose: string; date: string; start_time: string; end_time: string; people: number; needs: string[] }): string {
  let inner: string;
  if (rooms.length) {
    const items = rooms.map((r) => {
      const sel = JSON.stringify({ ...query, room: r.name }).replace(/'/g, "&#39;");
      const tags = (r.tags ?? []).join(", ") || r.features;
      return `<div class="item"><div><b>${esc(r.name)}</b><div class="sub">${esc(r.building)} &middot; fits ${esc(r.capacity)} &middot; ${esc(tags)}</div></div><button class="primary pick" data-sel='${sel}'>Request this room</button></div>`;
    }).join("");
    inner = `${note ? `<div class="sub" style="padding:12px 24px 0">${esc(note)}</div>` : ""}<div class="list">${items}</div>`;
  } else {
    inner = `<div class="body" style="padding:24px"><b>No rooms are free for that time.</b><div class="sub" style="margin-top:6px">${esc(note || "Try another time or date.")}</div></div>`;
  }
  const body = `<div class="card"><div class="head"><b>Available rooms</b><span>Step 2 of 2</span></div>${inner}</div>`;
  const script = String.raw`
document.querySelectorAll(".pick").forEach((b) => b.addEventListener("click", () => {
  const s = JSON.parse(b.dataset.sel);
  b.disabled = true; b.textContent = "Requesting...";
  const text = "Request " + s.room + " for " + s.purpose + " on " + s.date + " from " + s.start_time + " to " + s.end_time + " for " + s.people + " people.\n\n<!--room-select " + JSON.stringify(s) + "-->";
  parent.postMessage({ type: "input:prompt:submit", text }, "*");
}));`;
  return page(body, script);
}
