---
name: github
description: Read Richard's public GitHub repositories live - list them, read READMEs and files, see recent commits, search code.
workflows:
  repos:
    description: Richard's public repositories with language, stars, topics and last push.
    impl: skills.github.workflows:repos
    args:
      limit: {type: integer, default: 20, ge: 1, le: 100, description: "How many to list."}
      sort: {type: string, default: pushed, enum: [pushed, updated, created, full_name], description: "Sort order."}
  readme:
    description: A repository's README.
    impl: skills.github.workflows:readme
    args:
      repo: {type: string, required: true, description: "Repository name, e.g. k8s-agents-service."}
  commits:
    description: The latest commits on a repository's default branch.
    impl: skills.github.workflows:commits
    args:
      repo: {type: string, required: true, description: "Repository name."}
      limit: {type: integer, default: 10, ge: 1, le: 50}
  file:
    description: A file's contents, or a folder's listing, from a repository.
    impl: skills.github.workflows:file
    args:
      repo: {type: string, required: true, description: "Repository name."}
      path: {type: string, required: true, description: "Path inside the repo; empty string for the root folder."}
  search_code:
    description: Search code across Richard's public repositories, or one of them.
    impl: skills.github.workflows:search_code
    args:
      query: {type: string, required: true, description: "Words or identifiers to find."}
      repo: {type: string, description: "Limit to this repository."}
      limit: {type: integer, default: 10, ge: 1, le: 30}
---
Use this for what Richard is building now: the resume search (`search_richard`) only knows what the last
scheduled scrape stored, while this reads GitHub directly.

- Only Richard's public repositories are reachable. Others' repositories and private ones are refused.
- Start with `github.repos` when you don't know the exact repository name.
- For "what is X about", read the README; for "what changed lately", read the commits; read a file only
  when the question is about specific code.
- Link to the repository or file you used.
