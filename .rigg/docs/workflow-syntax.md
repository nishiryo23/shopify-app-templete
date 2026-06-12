# Rigg Workflow YAML Guide

Rigg is a local-first workflow builder for coding. It orchestrates Codex, Claude Code, Cursor ACP, and shell steps with structured control flow.

Workflow files live in `.rigg/` and are run with `rigg run <workflow_id>`.
If you omit a declared workflow input from `--input`, `rigg run` prompts for it before execution starts so you can confirm or override the default interactively.
Enter JSON for non-string values such as booleans, numbers, arrays, and objects.

For complete field-by-field details, see [schema-reference.md](schema-reference.md).
For complete workflow examples, see [examples.md](examples.md).

## CLI Commands

```bash
rigg init
rigg validate
rigg run <workflow_id> --input key=value
```

## Key Rules

1. Access step outputs via `steps.<id>.result`
2. `codex` uses `kind: turn` or `kind: review`
3. `cursor` returns plain text, so parse JSON in a following shell step when needed
4. `workflow` composes another workflow inside the same `.rigg` project
5. Unknown YAML keys cause validation errors
