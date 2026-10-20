const HUES = [262, 22, 235, 250, 10, 220];

/** Stable colour per name, so an agent or category looks the same everywhere. */
export function hueOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
