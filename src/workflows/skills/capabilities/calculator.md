---
id: calculator
doc_type: capability
kind: workflow
order: 1
execution:
  impl: workflows.impls.calculator
  arg_schema:
    expression:
      type: string
      required: true
      position: 1
      description: A valid numexpr-formatted math expression. Constants `pi` and `e` are available.
---

--- list_capabilities ---
- Kind: `workflow`
- Summary: Evaluate a math expression with numexpr.
- When to use: A user asks for the result of an arithmetic or scientific math expression.
- Next step: `read_capability(capability_id="calculator")`

--- read_capability ---
## Capability: `calculator`

- Kind: `workflow`

### Description
Evaluates a numerical expression using `numexpr`. Supports `+`, `-`, `*`, `/`, `**`,
parentheses, and the constants `pi` and `e`. Not for symbolic math; numbers only.

### Arg Usage
{{ARG_USAGE}}

### Arguments
{{ARG_TABLE}}

### Examples
1. `calculator "2 + 2"`
2. `calculator "sqrt(81) * pi"`
3. `calculator --expression "(3.5 + 1.5) ** 2"`

### Constraints
- Input must be a single numerical expression — not a sentence.
- No symbolic / algebraic manipulation; pass concrete numbers.

### Expected Output Summary
{{EXPECTED_OUTPUT_SUMMARY}}
