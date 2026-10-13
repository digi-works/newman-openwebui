function __digiMd(src, J) {
  // Markdown for assistant replies: tables, headings, lists, quotes, code, rules, **bold**, *italic*, `code`, [links](https://...).
  // Builds React elements only (never HTML strings), so model output cannot inject markup.
  const SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const FENCE = /^\s*(```|~~~)/;
  const HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const QUOTE = /^\s{0,3}>\s?/;
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const isTable = (ls, i) => ls[i].includes("|") && i + 1 < ls.length && ls[i + 1].includes("-") && SEP.test(ls[i + 1]) && (ls[i + 1].includes("|") || cells(ls[i]).length > 1);
  const starts = (ls, i) => FENCE.test(ls[i]) || HEAD.test(ls[i]) || RULE.test(ls[i]) || QUOTE.test(ls[i]) || ITEM.test(ls[i]) || isTable(ls, i);

  const inline = (s, k) => {
    const out = [];
    const re = /(`[^`\n]+`)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<![*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])|(?<![_\w])_(?!\s)([^_\n]+?)_(?![_\w])|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
    let last = 0, m, n = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      const key = k + "." + n++;
      if (m[1]) out.push(J("code", { className: "rounded bg-muted px-1 py-0.5 font-mono text-xs", children: m[1].slice(1, -1) }, key));
      else if (m[2] || m[3]) out.push(J("strong", { className: "font-semibold", children: inline(m[2] || m[3], key) }, key));
      else if (m[4] || m[5]) out.push(J("em", { children: inline(m[4] || m[5], key) }, key));
      else if (/^(https?:\/\/|mailto:)/i.test(m[7])) out.push(J("a", { href: m[7], target: "_blank", rel: "noopener noreferrer", className: "underline underline-offset-4", children: inline(m[6], key) }, key));
      else out.push(m[0]);
      last = re.lastIndex;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  const lines = (ls, k) => ls.flatMap((l, i) => (i ? [J("br", {}, k + "br" + i), ...inline(l, k + "l" + i)] : inline(l, k + "l" + i)));

  const ls = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < ls.length) {
    const l = ls[i], k = "b" + blocks.length;
    if (!l.trim()) { i++; continue; }
    if (FENCE.test(l)) {
      const fence = l.trim().slice(0, 3), code = [];
      for (i++; i < ls.length && !ls[i].trim().startsWith(fence); i++) code.push(ls[i]);
      i++;
      blocks.push(J("pre", { className: "overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs", children: J("code", { children: code.join("\n") }) }, k));
      continue;
    }
    if (isTable(ls, i)) {
      const head = cells(l);
      const align = cells(ls[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "text-center" : c.endsWith(":") ? "text-right" : "text-left"));
      const rows = [];
      for (i += 2; i < ls.length && ls[i].trim() && ls[i].includes("|"); i++) rows.push(cells(ls[i]));
      blocks.push(J("div", { className: "overflow-x-auto rounded-lg border", children: J("table", { className: "w-full text-sm tabular-nums", children: [
        J("thead", { className: "bg-muted/50 text-xs text-muted-foreground", children: J("tr", { children: head.map((h, c) => J("th", { className: "px-3 py-2 font-medium " + (align[c] || "text-left"), children: inline(h, k + "h" + c) }, c)) }) }, "h"),
        J("tbody", { children: rows.map((r, ri) => J("tr", { className: "border-t", children: head.map((_, c) => J("td", { className: "px-3 py-2 " + (align[c] || "text-left"), style: { verticalAlign: "top" }, children: inline(r[c] || "", k + "r" + ri + "c" + c) }, c)) }, ri)) }, "b"),
      ] }) }, k));
      continue;
    }
    let m = HEAD.exec(l);
    if (m) {
      blocks.push(J("p", { className: m[1].length <= 2 ? "text-base font-semibold" : "font-semibold", children: inline(m[2], k) }, k));
      i++;
      continue;
    }
    if (RULE.test(l)) { blocks.push(J("hr", { className: "border-border" }, k)); i++; continue; }
    if (QUOTE.test(l)) {
      const q = [];
      for (; i < ls.length && QUOTE.test(ls[i]); i++) q.push(ls[i].replace(QUOTE, ""));
      blocks.push(J("blockquote", { className: "text-muted-foreground", style: { borderLeft: "2px solid var(--border)", paddingLeft: "0.75rem" }, children: lines(q, k) }, k));
      continue;
    }
    if ((m = ITEM.exec(l))) {
      const ordered = /\d/.test(m[2]), first = ordered ? parseInt(m[2], 10) : 1, base = m[1].length, items = [];
      while (i < ls.length) {
        const it = ITEM.exec(ls[i]);
        if (it && /\d/.test(it[2]) === ordered || it && it[1].length > base) {
          items.push({ depth: Math.min(3, Math.floor(Math.max(0, it[1].length - base) / 2)), sub: /\d/.test(it[2]) !== ordered, text: [it[3]] });
          i++;
        } else if (items.length && ls[i].trim() && /^\s+/.test(ls[i]) && !starts(ls, i)) {
          items[items.length - 1].text.push(ls[i].trim());
          i++;
        } else break;
      }
      blocks.push(J(ordered ? "ol" : "ul", { start: ordered && first !== 1 ? first : undefined, style: { listStyle: ordered ? "decimal" : "disc", paddingLeft: "1.25rem" }, children: items.map((it, n) => J("li", { style: { marginLeft: it.depth * 1.25 + "rem", marginTop: n ? "0.25rem" : 0, listStyle: it.depth ? (it.sub ? "disc" : "circle") : undefined }, children: lines(it.text, k + "i" + n) }, n)) }, k));
      continue;
    }
    const p = [];
    for (; i < ls.length && ls[i].trim() && (!p.length || !starts(ls, i)); i++) p.push(ls[i]);
    blocks.push(J("p", { children: lines(p, k) }, k));
  }
  return blocks;
}
