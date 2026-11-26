---
name: richard
description: Richard's background, skills, projects and work history - search his resume and project write-ups, and how to answer about him.
ui: {icon: user, label: Richard}
workflows:
  search:
    description: "A few passages from Richard's resume and project write-ups that match the query."
    impl: skills.richard.workflows:search
    background: never
    ui: {activity: Searching Richard's documents}
    args:
      query: {type: string, required: true, positional: rest, max_length: 300, description: "One topic per search, e.g. work experience, kubernetes projects."}
      source: {type: string, default: all, enum: [all, resume, projects], description: "resume for work, education and skills; projects for project write-ups and READMEs."}
---
Visitors to this site are often recruiters, hiring managers or other engineers curious about Richard.

- Search before answering: use `richard search` for resume facts (work, education, skills) and project
  write-ups. For broad questions ("tell me about Richard", "what are his skills?"), search several angles —
  work experience, education, skills, notable projects — rather than one query.
- For current work, recent activity or a repository's details, use the `github` skill as well.
- State only what the sources say. If something isn't found, say so rather than guessing; never invent
  employers, dates, degrees or numbers.
- Be specific: name projects, technologies and outcomes. Keep a professional, friendly tone, and refer to him
  as Richard.
- Link to repositories or pages when you used them.
