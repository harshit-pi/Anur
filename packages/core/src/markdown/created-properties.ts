/**
 * The properties Anur gives a doc it creates (people): who made it, by their
 * handle, and the day, as Obsidian shows them. Written once, at creation;
 * keys a doc already has are kept as they are.
 */
export type CreatedProperties = { owner: string; created: string };

/** A value as YAML reads it back unchanged: quoted only when it has to be. */
const plain = (v: string) => (/^[\w .@-]+$/.test(v) && !/^\s|\s$/.test(v) ? v : JSON.stringify(v));

export function withCreatedProperties(text: string, p: CreatedProperties): string {
  const lines = [`owner: [${plain(p.owner)}]`, `created: ${p.created}`];
  const open = /^---\r?\n/.exec(text);
  const close = open ? /\r?\n---[ \t]*(\r?\n|$)/.exec(text.slice(open[0].length - 1)) : null;
  if (open && close) {
    const end = open[0].length - 1 + close.index;
    const yaml = text.slice(open[0].length, end + 1);
    const has = (key: string) => new RegExp(`^${key}\\s*:`, "m").test(yaml);
    const add = lines.filter((l) => !has(l.slice(0, l.indexOf(":"))));
    if (!add.length) return text;
    return `${text.slice(0, end + 1)}${add.join("\n")}\n${text.slice(end + 1).replace(/^\r?\n/, "")}`;
  }
  return `---\n${lines.join("\n")}\n---\n\n${text}`;
}

/** Today as YYYY-MM-DD, in the person's own time zone. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
