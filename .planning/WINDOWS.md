---
schema_version: 1
open_count: 0
waived_count: 0
fixed_count: 1
total_count: 1
last_updated: 2026-10-01T14:34:41.666Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`. Waive with
> `gsd-tools windows waive <id> "<reason>"` (reason required). Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind      | file             | line | description                                                                         | status | reason | recorded_at              | resolved_at              |
| -- | ----- | --------- | ---------------- | ---- | ----------------------------------------------------------------------------------- | ------ | ------ | ------------------------ | ------------------------ |
| 1  | 01    | deviation | src/utils/url.ts |      | Replaced lint-invalid control-character regex with an explicit code-point predicate | fixed  |        | 2026-10-01T14:34:27.612Z | 2026-10-01T14:34:41.666Z |

```json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "01",
    "file": "src/utils/url.ts",
    "line": null,
    "description": "Replaced lint-invalid control-character regex with an explicit code-point predicate",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-01T14:34:27.612Z",
    "resolved_at": "2026-10-01T14:34:41.666Z"
  }
]
```
