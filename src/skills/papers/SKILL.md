---
name: papers
description: Research papers - search arXiv, read a paper's full text, and make two-host podcast episodes about a paper or a whole research topic.
ui: {icon: file-text, label: Papers}
workflows:
  search:
    description: "Searches arXiv and lists papers with authors, dates, ids and abstracts."
    impl: skills.papers.workflows:search
    ui: {activity: Searching arXiv}
    args:
      query: {type: string, required: true, positional: rest, max_length: 300, description: "Topic or title words."}
      limit: {type: integer, default: 8, ge: 1, le: 25, short: L}
      sort: {type: string, default: relevance, enum: [relevance, newest]}
  read:
    description: "The paper's title, authors, abstract and the first part of its full text."
    impl: skills.papers.workflows:read
    ui: {activity: Reading a paper}
    args:
      paper: {type: string, required: true, positional: true, max_length: 500, description: "An arXiv id or link, or a link to a paper's PDF or page."}
  podcast:
    description: "Writes and records a two-host podcast episode. Given a topic, it finds the papers that best cover it on arXiv, reads them, adds web context and discusses them together; given an arXiv id or link, it covers that one paper. Takes a few minutes; the episode plays in the chat."
    impl: skills.papers.workflows:podcast
    ui: {activity: Making a podcast}
    background: always
    args:
      subject: {type: string, required: true, positional: rest, max_length: 500, description: "A research topic, or an arXiv id or link (or a paper's PDF or page link) for a single-paper episode."}
      papers: {type: integer, default: 4, ge: 2, le: 6, short: n, description: "For a topic: how many papers to draw on."}
      length: {type: string, default: standard, enum: [short, standard, long], description: "About 5, 10 or 17 minutes."}
      focus: {type: string, max_length: 300, description: "Optional emphasis the user asked for, such as the math or practical uses."}
      web: {type: boolean, default: true, description: "For a topic: add web pages for context beyond the papers."}
---
Use `papers search` to find papers on a topic or to pin down the paper the user means; prefer it to
`web search` for academic topics. Show results as a short list with linked titles, authors and year.

Use `papers read` to answer questions about a specific paper from its own text, citing the paper's
link. If the text is cut off and the answer isn't in it, say so.

Use `papers podcast` when the user asks for a podcast, episode, audiobook or audio overview:
- For a topic or field ("a podcast on speculative decoding"), pass the topic as they put it, e.g.
  `papers podcast speculative decoding for LLM inference -n 5`. The workflow finds and picks the papers
  itself, so don't search first.
- For one specific paper, pass its arXiv id or link: `papers podcast 1706.03762`. If they name a paper
  without a link or id, find it with `papers search` first and confirm it's the right one when the
  match isn't obvious.
- Pass `--focus` only when the user asked for an emphasis, and `--length` only when they asked for a
  length.
