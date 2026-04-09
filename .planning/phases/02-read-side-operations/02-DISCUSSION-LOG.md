# Phase 2: Read-Side Operations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-09
**Phase:** 02-read-side-operations
**Areas discussed:** DELETE response body, List endpoint errors

---

## DELETE response body

| Option | Description | Selected |
|--------|-------------|----------|
| 204 No Content (Recommended) | Return 204 with no body for all successful deletes. Simplest, matches current null body behavior with correct status code. | ✓ |
| 200 with blob descriptor | Return 200 with a JSON blob descriptor so client knows what was deleted. More informative but adds response construction. | |
| Mixed: 200 when purged, 204 when ownership removed | Return 200 with descriptor when blob is fully purged, 204 when only ownership removed. Leaks multi-owner info. | |

**User's choice:** 204 No Content
**Notes:** Simple and clean — no body construction needed.

### Follow-up: DELETE 404 behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, keep 404 (Recommended) | Current behavior returns 404 for missing blobs. Matches DELT-02. | ✓ |
| Return 204 for missing blobs too | Idempotent delete — 204 whether blob existed or not. Doesn't match spec. | |

**User's choice:** Keep 404
**Notes:** Matches spec requirement DELT-02.

---

## List endpoint errors

| Option | Description | Selected |
|--------|-------------|----------|
| Keep all as-is (Recommended) | 404 for disabled, 401 for missing auth, 403 for listing others' blobs. Standard HTTP semantics. | ✓ |
| Change disabled to 403 | Return 403 Forbidden instead of 404 when endpoint is disabled. Reveals endpoint existence. | |
| Remove auth errors | Only return 200 and 400 as spec says. Removes security guards. | |

**User's choice:** Keep all as-is
**Notes:** Standard HTTP semantics beyond spec minimum are acceptable.

### Follow-up: Query parameter validation

| Option | Description | Selected |
|--------|-------------|----------|
| Keep current validation (Recommended) | Per-parameter validation with specific error messages. Already compliant and more helpful. | ✓ |
| Add stricter validation | Additional checks like limit bounds, since < until. Goes beyond spec. | |
| You decide | Claude discretion on validation details. | |

**User's choice:** Keep current validation
**Notes:** Already compliant with LIST-02 requirement for 400 on malformed params.

---

## Claude's Discretion

- Error message wording for X-Reason headers
- Test structure and organization for Phase 2 tests

## Deferred Ideas

None — discussion stayed within phase scope.
