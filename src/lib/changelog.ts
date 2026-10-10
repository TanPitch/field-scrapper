export interface ChangelogGroup {
  /** Version heading, e.g. `2.1.0 - 2026-10-08` or `Unreleased`. */
  version: string;
  /** `### Section` headings with their bullets, in file order. */
  sections: { heading: string; items: string[] }[];
}

/**
 * Parses RELEASE_NOTES.md into version headers + bullet lists.
 *
 * Kept deliberately dumb: it understands only what that file actually uses —
 * `## version`, `### section` and `- bullet` — and skips prose/blank lines.
 * Bullets that wrap onto indented continuation lines are joined back together.
 */
export function parseChangelog(md: string): ChangelogGroup[] {
  const groups: ChangelogGroup[] = [];
  let group: ChangelogGroup | null = null;
  let section: { heading: string; items: string[] } | null = null;

  const endSection = () => {
    if (group && section) group.sections.push(section);
    section = null;
  };
  const endGroup = () => {
    endSection();
    if (group) groups.push(group);
    group = null;
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();

    const h2 = /^##\s+(?!#)(.+)$/.exec(line);
    if (h2) {
      endGroup();
      group = { version: h2[1].trim(), sections: [] };
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      endSection();
      section = { heading: h3[1].trim(), items: [] };
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet && section) {
      section.items.push(bullet[1]);
      continue;
    }
    /* indented continuation of the previous bullet */
    if (section && section.items.length && /^\s+\S/.test(raw) && line.trim() && !line.startsWith('#')) {
      section.items[section.items.length - 1] += ' ' + line.trim();
      continue;
    }
    if (line.trim() && !line.startsWith('#')) {
      /* prose outside any list (intro, hints) — keep it under the version */
      if (group && !section) section = { heading: '', items: [] };
      section?.items.push(line.trim());
    }
  }
  endGroup();
  return groups;
}

/** "2.1.0 - 2026-10-08" -> "2.1.0"; anything else (e.g. Unreleased) is kept whole. */
export const changelogVersion = (v: string): string => (/^[\w.]+/.exec(v)?.[0] ?? v);

type Chunk = { t: 'text'; v: string } | { t: 'b'; v: string } | { t: 'c'; v: string };

/**
 * Splits a line into plain text, **bold** and `code` runs. Only those three are
 * recognised — that is everything RELEASE_NOTES.md actually uses, and it keeps
 * the renderer free of an HTML parser.
 */
export function parseInline(md: string): Chunk[] {
  const out: Chunk[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (m.index > last) out.push({ t: 'text', v: md.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'b', v: m[1] });
    else out.push({ t: 'c', v: m[2] });
    last = m.index + m[0].length;
  }
  if (last < md.length) out.push({ t: 'text', v: md.slice(last) });
  return out;
}