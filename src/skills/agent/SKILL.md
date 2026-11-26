---
name: agent
description: Start a sub-agent - a copy of you with a fresh context - for independent parts of a task or heavy reading.
ui: {icon: bot, label: Sub-agent}
workflows:
  main:
    description: "Runs a sub-agent on the brief and returns its final answer. It sees only the brief, never this conversation."
    impl: skills.agent.workflows:main
    ui: {activity: Working with a sub-agent, card: subagent}
    args:
      brief: {type: string, required: true, positional: rest, input: true, max_length: 20000, description: "A specific, self-contained task with everything the sub-agent needs."}
      type: {type: string, max_length: 64, description: "The sub-agent's focus, from your instructions. Leave it out for a general one."}
      thread: {type: string, max_length: 64, description: "To continue an earlier sub-agent, the thread from the end of its result."}
---
Write the brief in a heredoc. Run several in one turn for parts that can happen at the same time.
