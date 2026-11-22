---
name: papers
description: Research papers - search arXiv, read a paper's full text, and turn a paper into a two-host podcast episode.
workflows:
  search:
    description: "Searches arXiv and lists papers with authors, dates, ids and abstracts."
    impl: skills.papers.workflows:search
    args:
      query: {type: string, required: true, max_length: 300, description: "Topic or title words."}
      limit: {type: integer, default: 8, ge: 1, le: 25}
      sort: {type: string, default: relevance, enum: [relevance, newest]}
  read:
    description: "The paper's title, authors, abstract and the first part of its full text."
    impl: skills.papers.workflows:read
    args:
      paper: {type: string, required: true, max_length: 500, description: "An arXiv id or link, or a link to a paper's PDF or page."}
  podcast:
    description: "Writes and records a podcast episode in which two hosts discuss the paper. Takes a few minutes; the episode plays in the chat."
    impl: skills.papers.workflows:podcast
    background: true
    args:
      paper: {type: string, required: true, max_length: 500, description: "An arXiv id or link, or a link to a paper's PDF or page."}
      length: {type: string, default: standard, enum: [short, standard, long], description: "About 5, 10 or 17 minutes."}
      focus: {type: string, max_length: 300, description: "Optional emphasis the user asked for, such as the math or practical uses."}
---
Use `papers.search` to find papers on a topic or to pin down the paper the user means; prefer it to
`web_search` for academic topics. Show results as a short list with linked titles, authors and year.

Use `papers.read` to answer questions about a specific paper from its own text, citing the paper's
link. If the text is cut off and the answer isn't in it, say so.

Use `papers.podcast` when the user asks for a podcast, episode or audio overview of a paper. If they
describe a paper without a link or id, find it with `papers.search` first and confirm it's the right
one when the match isn't obvious. Pass `focus` only when the user asked for an emphasis.
