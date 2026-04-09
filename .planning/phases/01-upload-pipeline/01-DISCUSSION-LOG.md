# Phase 1: Upload Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-09
**Phase:** 01-upload-pipeline
**Areas discussed:** 507 storage-full detection, Hash mismatch error path, Error response type updates

---

## 507 Storage-Full Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Catch write failures only | Let the upload proceed and return 507 only when the actual disk/S3 write fails. Simplest approach — relies on OS/S3 errors. | |
| Proactive space check | Check available disk space (or configured quota) before starting the upload. Rejects early with 507. | |
| You decide | Claude picks the best approach based on the codebase patterns. | |
| Skip entirely | User's own input — skip implementing 507 as it does not provide value. | ✓ |

**User's choice:** Skip implementing 507 entirely — does not provide value for the server or client.
**Notes:** UPLD-06 intentionally not implemented per user decision.

---

## Hash Mismatch Error Path

| Option | Description | Selected |
|--------|-------------|----------|
| Structured worker errors | Worker posts typed error object (e.g. { id, error: 'HASH_MISMATCH', message }). Main thread maps types to HTTP status codes. | ✓ |
| String pattern matching | Main thread checks if worker error starts with 'Hash mismatch' and returns 409 for that case. Minimal change. | |
| You decide | Claude picks the approach that fits the existing worker protocol. | |

**User's choice:** Structured worker errors
**Notes:** None

---

## Error Response Type Updates

| Option | Description | Selected |
|--------|-------------|----------|
| Expand for all phases now | Add 409, 416, 422, 507 to errorResponse() upfront so Phase 2 and 3 don't touch it again. | ✓ |
| Per-phase additions only | Only add 409 now. Phase 2 adds 416, Phase 3 adds 422. Keeps diffs minimal. | |
| You decide | Claude picks based on scope and churn. | |

**User's choice:** Expand for all phases now
**Notes:** None

---

## Claude's Discretion

- Error message wording for X-Reason headers on new status codes
- Internal refactoring approach for worker error types
- Whether to add explicit 200 status to the dedup path

## Deferred Ideas

None — discussion stayed within phase scope
