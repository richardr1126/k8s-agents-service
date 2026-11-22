/**
 * Plain text for reading a markdown reply aloud: no code blocks, links, citation
 * numbers, source lists or markup. Headings and list items end in a pause.
 */
const SOURCE_LINE = /^\s*(?:[-*]\s*)?(?:\[\d{1,3}\]|\d{1,3}[.)])\s*(?:\[[^\]]*\]\(https?:\/\/[^)\s]+\)|.*<https?:\/\/[^>\s]+>)/;
const SOURCES_HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?(?:sources|references|citations)(?:\*\*|__)?:?\s*$/i;

export function speakable(markdown: string): string {
  const lines = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    if (SOURCE_LINE.test(raw) || SOURCES_HEADING.test(raw)) continue;
    if (/^\s*(?:[-*_]\s*){3,}$/.test(raw) || /^\s*\|?\s*:?-{3,}/.test(raw)) continue; // rules, table separators
    let line = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?:\([^)]*\))?/g, "") // citation numbers
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*>+\s?/, "")
      .replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, "")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/\s*\|\s*/g, ", ")
      .replace(/^,\s*|,\s*$/g, "")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!line) continue;
    if (!/[.!?:;,"')\]]$/.test(line)) line += ".";
    out.push(line);
  }
  return out.join(" ");
}

/** Splits text at sentence ends into pieces of at most `max` characters, for one request each. */
export function speechPieces(text: string, max = 1200): string[] {
  const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) ?? [];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    for (let s = sentence; s; ) {
      const room = max - current.length;
      if (s.length <= room) {
        current += s;
        s = "";
      } else if (current) {
        pieces.push(current.trim());
        current = "";
      } else {
        const cut = s.lastIndexOf(" ", max) > max / 2 ? s.lastIndexOf(" ", max) : max;
        pieces.push(s.slice(0, cut).trim());
        s = s.slice(cut);
      }
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.filter(Boolean);
}
