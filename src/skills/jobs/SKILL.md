---
name: jobs
description: Background jobs in this chat - check one's progress or result, or list what is running.
ui: {icon: clock, label: Jobs}
workflows:
  check:
    description: "A job's progress, or its result once it has ended."
    impl: skills.jobs.workflows:check
    background: never
    ui: {activity: Checking a job}
    args:
      job: {type: string, required: true, positional: true, max_length: 64, description: "The job id, e.g. job-1a2b3c4d5e6f."}
  list:
    description: "The jobs still running in this chat."
    impl: skills.jobs.workflows:running
    background: never
    ui: {activity: Listing jobs}
---
Any command can run as a job with `--bg`, and some always do. The user watches each job in a card, and
you get a `<job-event>` when one ends, so only check a job when the user asks about it.
