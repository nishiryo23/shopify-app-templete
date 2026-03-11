---
name: product-import-pipeline
description: Use when a task touches product export/import, manifest signing, preview, confirm, bulk write, verify, or undo.
---
Required invariants:
- product GA only
- closed-loop CSV only
- productUpdate only
- preview before write
- owner-only confirm/undo
- final-state verification defines success
