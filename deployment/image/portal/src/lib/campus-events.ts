import { withTenant } from "./digi-db";

/**
 * Campus events (the events.search tool): the events and class times imported into Digi (scripts/import-supabase.mjs), read only.
 * Anyone who can use Digi can see what is on; dates and times are in the campus time zone.
 */
export type CampusEvent = { name: string; type: string; date: string; start: string; end: string; location: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;
const MAX_ITEMS = 50;

export class EventSearchError extends Error {}

export async function searchEvents(
  tenantId: string, q: { from?: string; to?: string; text?: string; includeClasses?: boolean },
): Promise<{ from: string; to: string; items: CampusEvent[]; more: boolean }> {
  if ((q.from && !DATE.test(q.from)) || (q.to && !DATE.test(q.to))) throw new EventSearchError("Give dates as YYYY-MM-DD.");
  return withTenant(tenantId, async (c) => {
    const cfg = (await c.query("select configuration from tenants where id = $1", [tenantId])).rows[0]?.configuration as { timezone?: string } | undefined;
    const tz = cfg?.timezone || "America/Chicago";
    const today = (await c.query(`select to_char(now() at time zone $1, 'YYYY-MM-DD') as d`, [tz])).rows[0].d as string;
    const from = q.from || today;
    const to = q.to || (await c.query(`select to_char($1::date + 7, 'YYYY-MM-DD') as d`, [from])).rows[0].d as string;
    const span = (await c.query(`select $2::date - $1::date as n`, [from, to])).rows[0].n as number;
    if (span < 0) throw new EventSearchError("The end date is before the start date.");
    if (span > MAX_DAYS) throw new EventSearchError(`Ask for at most ${MAX_DAYS} days at a time.`);

    const { rows } = await c.query(
      `select e.name, e.type,
              to_char(o.starts_at at time zone $1, 'YYYY-MM-DD') as day, to_char(o.starts_at at time zone $1, 'HH24:MI') as st,
              to_char(o.ends_at at time zone $1, 'HH24:MI') as et,
              coalesce(nullif(concat_ws(', ', r.display_name, bl.name), ''), o.location_text, '') as location
         from event_occurrences o
         join events e on e.id = o.event_id
         left join rooms r on r.id = o.room_id
         left join buildings bl on bl.id = r.building_id
        where o.status = 'confirmed'
          and o.ends_at > now()
          and o.starts_at >= ($2::date)::timestamp at time zone $1
          and o.starts_at < ($3::date + 1)::timestamp at time zone $1
          and ($4 or e.type <> 'course')
          and ($5 = '' or e.name ilike '%' || $5 || '%')
        order by o.starts_at, e.name
        limit ${MAX_ITEMS + 1}`,
      [tz, from, to, !!q.includeClasses, q.text ?? ""],
    );
    const items = rows.slice(0, MAX_ITEMS).map((r): CampusEvent => ({ name: r.name, type: r.type, date: r.day, start: r.st, end: r.et, location: r.location }));
    return { from, to, items, more: rows.length > MAX_ITEMS };
  });
}
