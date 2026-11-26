---
name: github
description: Read Richard's public GitHub repositories live - list them, read READMEs and files, see recent commits, search code.
ui: {icon: github, label: GitHub}
workflows:
  repo.list:
    description: Richard's public repositories with language, stars, topics and last push.
    impl: skills.github.workflows:repos
    ui: {activity: Listing repositories}
    args:
      limit: {type: integer, default: 20, ge: 1, le: 100, short: L, description: "How many to list."}
      sort: {type: string, default: pushed, enum: [pushed, updated, created, full_name], description: "Sort order."}
  repo.view:
    description: A repository's README.
    impl: skills.github.workflows:readme
    ui: {activity: Reading a README}
    args:
      repo: {type: string, required: true, positional: true, description: "Repository name, e.g. k8s-agents-service (owner/name works too)."}
  commits:
    description: The latest commits on a repository's default branch.
    impl: skills.github.workflows:commits
    ui: {activity: Reading commits}
    args:
      repo: {type: string, required: true, positional: true, description: "Repository name."}
      limit: {type: integer, default: 10, ge: 1, le: 50, short: L}
  file:
    description: A file's contents, or a folder's listing, from a repository.
    impl: skills.github.workflows:file
    ui: {activity: Reading a file}
    args:
      repo: {type: string, required: true, positional: true, description: "Repository name."}
      path: {type: string, default: "", positional: true, description: "Path inside the repo; leave it out for the root folder."}
  search.code:
    description: Search code across Richard's public repositories, or one of them.
    impl: skills.github.workflows:search_code
    ui: {activity: Searching code}
    args:
      query: {type: string, required: true, positional: rest, description: "Words or identifiers to find."}
      repo: {type: string, short: R, description: "Limit to this repository."}
      limit: {type: integer, default: 10, ge: 1, le: 30, short: L}
---
Use this for what Richard is building now: the resume search (`richard search`) only knows what the last
scheduled scrape stored, while this reads GitHub directly.

- Only Richard's public repositories are reachable. Others' repositories and private ones are refused.
- Start with `github repo list` when you don't know the exact repository name.
- For "what is X about", read the README (`github repo view`); for "what changed lately", read the
  commits; read a file only when the question is about specific code.
- Link to the repository or file you used.
- Commands follow `gh` habits (the repository first, `-L` for limits, `-R` to pick a repository when
  searching), but only the workflows below exist: there is no `gh pr`, `gh api` or `--json`.
