---
name: web
description: Search the web and read pages, for anything current or on a specific site.
ui: {icon: globe, label: Web}
workflows:
  search:
    description: "Numbered results with title, link, date and a short snippet. Read a page with `web read` when the snippet isn't enough."
    impl: skills.web.workflows:search
    background: never
    ui: {activity: Searching the web}
    args:
      query: {type: string, required: true, positional: rest, max_length: 400, description: "What to search for. Specific beats broad."}
      limit: {type: integer, default: 5, ge: 1, le: 10, short: n, description: "How many results."}
      news: {type: boolean, default: false, description: "Recent news instead of general results."}
      days: {type: integer, ge: 1, le: 365, description: "With --news: only the last N days."}
  read:
    description: "A web page's text, up to about 12,000 characters."
    impl: skills.web.workflows:read
    background: never
    ui: {activity: Reading a page}
    args:
      url: {type: string, required: true, positional: true, max_length: 2000, description: "The page's full http(s) link."}
---
For a question that needs several searches and pages weighed together, `research quick` does that in one
command. Link the pages you used.
