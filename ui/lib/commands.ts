/**
 * The agent's tool calls as command lines, and what the skill catalog says about each.
 *
 * The assistant has one tool, `run`, whose argument is a command line such as
 * `github commits openreader -L 5`. Older chats hold calls to the tools it had
 * before (`web_search`, `run_workflow`, ...), and a sub-agent is stored as a `task`
 * call. `commandOf` reads all of these as the command they stand for, and `lookup`
 * finds that command in the catalog the backend serves at GET /skills, which says
 * how its card looks.
 */

export type CatalogWorkflow = {
  id: string;
  description: string;
  background: "never" | "optional" | "always";
  ui: { activity?: string; card?: "default" | "subagent" };
};

export type CatalogSkill = {
  name: string;
  description: string;
  ui: { icon?: string; label?: string };
  workflows: CatalogWorkflow[];
};

export type Catalog = readonly CatalogSkill[];

export type CommandLine = { words: string[]; input: string | null; background: boolean };

const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;

/** Splits words the way a shell would; an open quote takes the rest of the line. */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && /["\\$`]/.test(line[i + 1] ?? "")) word += line[++i]!;
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (c === "\\" && i + 1 < line.length) {
      word = (word ?? "") + line[++i]!;
    } else if (/\s/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
    } else {
      word = (word ?? "") + c;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

/** Whether `text` ends inside an open quote. */
function inQuote(text: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"') i++;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "\\") i++;
  }
  return quote !== null;
}

/** A command line's words, its heredoc text and whether it asks for `--bg`. Never throws. */
export function splitCommand(command: string): CommandLine {
  let line = command.trim();
  let input: string | null = null;
  for (const match of line.matchAll(HEREDOC)) {
    const head = line.slice(0, match.index);
    if (inQuote(head)) continue;
    const end = match.index + match[0].length;
    const lineEnd = line.indexOf("\n", end);
    const marker = match[2]!;
    if (lineEnd < 0) {
      line = head + line.slice(end);
      input = "";
    } else {
      const lines = line.slice(lineEnd + 1).split("\n");
      const close = lines.findIndex((l) => l.trim() === marker);
      input = (close < 0 ? lines : lines.slice(0, close)).join("\n");
      line = head + line.slice(end, lineEnd);
    }
    break;
  }
  let words = shellWords(line);
  const stop = words.indexOf("--");
  const head = stop < 0 ? words : words.slice(0, stop);
  const background = head.includes("--bg");
  if (background) words = [...head.filter((w) => w !== "--bg"), ...(stop < 0 ? [] : words.slice(stop))];
  return { words, input, background };
}

function q(value: unknown): string {
  const s = String(value ?? "");
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'"'"'`)}'`;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The command an older tool call stands for, as the assistant would write it now. */
const LEGACY: Record<string, (args: Record<string, unknown>) => string> = {
  run_workflow: (a) => {
    let command = (str(a.command) || str(a.workflow)).trim();
    const [first = "", ...rest] = command.split(" ");
    if (first.includes(".")) command = [...first.split("."), ...rest].join(" ").trim();
    return a.background ? `${command} --bg` : command;
  },
  web_search: (a) => {
    const words = ["web search", q(a.query)];
    if (a.max_results) words.push("-n", String(a.max_results));
    if (a.topic === "news") words.push("--news");
    return words.join(" ");
  },
  fetch_page: (a) => `web read ${q(a.url)}`,
  search_richard: (a) =>
    a.source && a.source !== "all" ? `richard search ${q(a.query)} --source ${a.source}` : `richard search ${q(a.query)}`,
  check_job: (a) => `jobs check ${q(a.job_id)}`,
  list_skills: () => "skills list",
  read_skill: (a) => `${str(a.name) || "skills"} --help`,
};

/** The command line a tool call stands for, or null for a tool that isn't a command. */
export function commandOf(toolName: string, args: Record<string, unknown> = {}): string | null {
  if (toolName === "run") return str(args.command);
  return LEGACY[toolName]?.(args) ?? null;
}

export type Lookup = { skill?: CatalogSkill; workflow?: CatalogWorkflow; rest: string[] };

/** The skill and command a command line names in the catalog, and the words after them. */
export function lookup(catalog: Catalog | undefined, words: readonly string[]): Lookup {
  const [first = "", ...after] = words;
  // The older dotted form, `github.commits`, names the same command.
  const all = first.includes(".") ? [...first.split("."), ...after] : [...words];
  const skill = catalog?.find((s) => s.name === all[0]);
  if (!skill) return { rest: all.slice(1) };
  let best: CatalogWorkflow | undefined;
  let used = 1;
  for (const wf of skill.workflows) {
    const ids = wf.id.split(" ");
    if (ids.length >= used && ids.every((w, i) => all[i] === w) && (!best || ids.length > used)) {
      best = wf;
      used = ids.length;
    }
  }
  return { skill, workflow: best, rest: all.slice(used) };
}

export type Call = CommandLine &
  Lookup & {
    command: string;
    /** A sub-agent: the `agent` command, or a `task` call stored from one. */
    agent: { brief: string; type: string; thread?: string } | null;
  };

function flag(words: readonly string[], name: string): string | undefined {
  for (let i = 0; i < words.length; i++) {
    if (words[i] === name) return words[i + 1];
    if (words[i]!.startsWith(`${name}=`)) return words[i]!.slice(name.length + 1);
  }
  return undefined;
}

function positionals(words: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === "--") return [...out, ...words.slice(i + 1)];
    if (w === "--type" || w === "--thread" || w === "--brief") i++;
    else if (!w.startsWith("--")) out.push(w);
  }
  return out;
}

/** A tool call read as a command: its words, catalog entry and, for a sub-agent, its brief. */
export function describeCall(toolName: string, args: Record<string, unknown> = {}, catalog?: Catalog): Call | null {
  if (toolName === "task") {
    const type = str(args.subagent_type) || str(args.focus);
    const agent = { brief: str(args.description), type, thread: str(args.thread_id) || undefined };
    const found = lookup(catalog, ["agent"]);
    return { command: "agent", words: ["agent"], input: agent.brief, background: Boolean(args.background), ...found, agent };
  }
  // Some models call a skill as if it were a tool, `github({command: "repo list"})`; the
  // backend runs that as `github repo list`.
  const asSkill = catalog?.some((s) => s.name === toolName) ? `${toolName} ${str(args.command)}`.trim() : null;
  const command = commandOf(toolName, args) ?? asSkill;
  if (command === null) return null;
  const line = splitCommand(command);
  const found = lookup(catalog, line.words);
  const isAgent = found.workflow ? found.workflow.ui.card === "subagent" : line.words[0] === "agent";
  const agent = isAgent
    ? {
        brief: line.input ?? (flag(found.rest, "--brief") || positionals(found.rest).join(" ")),
        type: flag(found.rest, "--type") ?? "",
        thread: flag(found.rest, "--thread"),
      }
    : null;
  return { command, ...line, ...found, agent };
}

/** What the card's row says for a command: the skill's name, and what the command is about. */
export function callTitle(call: Call): { label: string; detail: string } {
  const name = call.skill?.ui.label ?? call.words[0] ?? "Command";
  const sub = call.workflow && call.workflow.id !== call.skill?.name ? call.workflow.id.split(" ").slice(1).join(" ") : "";
  const detail = positionals(call.rest).join(" ") || call.input?.split("\n", 1)[0] || "";
  return { label: sub ? `${name} ${sub}` : name, detail };
}
