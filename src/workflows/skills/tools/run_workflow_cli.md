---
id: run_workflow_cli
doc_type: tool
---
Execute a workflow capability by passing a single CLI-style command string. Format:
`<workflow_id> [positional values] [--flag value | --flag=value | -x value]`. Boolean
flags can be passed bare (`--flag`) or with an explicit value (`--flag true`). Quote
values that contain spaces with single quotes. Always run `read_capability` first to
see the exact arg schema for the workflow. Returns a markdown summary of the result.
