---
id: read_capability
doc_type: tool
---
Return the full documentation for a single workflow capability: arg usage line,
argument table, example invocations, constraints, and the expected output summary.
Always read this before calling `run_workflow_cli` for an unfamiliar workflow — it
shows the exact CLI flags, types, defaults, and required arguments. Pass the
`capability_id` exactly as it appears in `list_capabilities`.
