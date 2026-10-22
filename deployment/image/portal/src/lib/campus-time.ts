/**
 * A moment as the campus clock shows it. Pages are rendered on the server (UTC) and again in the browser (the viewer's zone and locale), so a
 * time formatted without a fixed zone and locale comes out different and React throws a hydration error (QA DEF-51). The home page already
 * shows campus time, so every timestamp does.
 */
export const CAMPUS_TZ = "America/Chicago";

const DEFAULT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };

export function campusTime(iso: string | number | Date, opts: Intl.DateTimeFormatOptions = DEFAULT): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString("en-US", { ...opts, timeZone: CAMPUS_TZ });
}
