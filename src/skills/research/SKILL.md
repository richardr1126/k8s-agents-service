---
name: research
description: Cited web research - plans several searches, reads the best pages and ranks the passages, for questions that need more than one quick search.
workflows:
  quick:
    description: "Searches a few angles in parallel, reads the top pages and returns numbered sources and passages to answer from. Takes 10-30 seconds."
    impl: skills.research.workflows:quick
    args:
      question: {type: string, required: true, max_length: 500, description: "The question, phrased fully, with any context it needs."}
  deep:
    description: "A thorough report: more angles and pages, written up with citations. Takes a few minutes."
    impl: skills.research.workflows:deep
    background: true
    args:
      question: {type: string, required: true, max_length: 500, description: "The question, phrased fully, with any context it needs."}
---
Use `research.quick` when a question needs several sources or angles: comparisons, "what's the state
of", recent developments, anything where one `web_search` would be thin. For a single fact, use
`web_search` instead. Use `research.deep` only when the user asks for a thorough or long report.

`research.quick` returns numbered sources and passages. Write the answer from them:
- Lead with a direct two- or three-sentence answer, then details in short sections or lists.
- Cite each claim with its source number as a link right after it, like [1](https://...), using
  the numbers and URLs from the sources list. Cite only what the passages support.
- If sources disagree, say so. If the passages don't cover part of the question, say that, or run
  `web_search` / `fetch_page` for the gap.
- End with a short "Sources" list of the sources you cited, then two or three follow-up questions
  the user might ask next, as a list.

`research.deep` returns a finished report; pass it on as written.
