/**
 * Turns bare citation numbers like "[2]" or "[2, 3]" into links to the matching
 * entry of the message's own sources list, so they render as citation chips.
 * Sources are read from lines like "[2] [Title](url)", "2. [Title](url)" or
 * "[2] Title <url>". Numbers with no matching source are left as they are.
 */
const SOURCE_LINE = /^\s*(?:[-*]\s*)?(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s*(?:\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|.*?<(https?:\/\/[^>\s]+)>)/gm;
const INLINE_SOURCE = /\[(\d{1,3})\]\s*\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
// A bracketed list of numbers that isn't already a link's text or a footnote ("[1]: ...").
const BARE = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?![(:])/g;

export function linkCitations(text: string): string {
  const urls = new Map<string, string>();
  for (const m of text.matchAll(SOURCE_LINE)) urls.set(m[1] ?? m[2], m[3] ?? m[4]);
  for (const m of text.matchAll(INLINE_SOURCE)) if (!urls.has(m[1])) urls.set(m[1], m[2]);
  if (urls.size === 0) return text;
  return text.replace(BARE, (whole, list: string, offset: number) => {
    // Leave the numbers that label the sources list itself.
    if (/^\[\d+\]\s*\[[^\]]*\]\(https?:/.test(text.slice(offset))) return whole;
    const nums = list.split(",").map((n) => n.trim());
    if (!nums.every((n) => urls.has(n))) return whole;
    return nums.map((n) => `[${n}](${urls.get(n)})`).join("");
  });
}
