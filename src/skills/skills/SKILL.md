---
name: skills
description: Find the command for a job - search every skill and its commands, or list them all.
ui: {icon: search, label: Skills}
workflows:
  search:
    description: "The skills and commands that best match what you need, with their usage."
    impl: skills.skills.workflows:search
    background: never
    ui: {activity: Looking for a skill}
    args:
      query: {type: string, required: true, positional: rest, max_length: 300, description: "What you want to do, in a few words."}
  list:
    description: "Every skill with its description and commands."
    impl: skills.skills.workflows:listing
    background: never
    ui: {activity: Listing skills}
---
`<skill> --help` shows a skill's full instructions and every command's options.
