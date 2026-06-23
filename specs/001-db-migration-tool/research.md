# Research: Laundry DB Migration Tool Migration Fixes

**Phase**: 0 — Research
**Date**: 2026-06-24

---

## 1. Active Runtime Direction

**Decision**: Keep the currently wired app path (`main.js` + `preload.js` + `renderer/` + `src/`) as the single runtime path and move specialized behavior into it.

**Rationale**:
- The current app already launches the `renderer/` interface and registers IPC handlers from `src/`.
- Reverting back to the old `migration/*.js` UI path would create two competing products inside one folder.
- Consolidation reduces drift between what the user sees and what specialized migration code actually does.

**Alternatives considered**:
- Restore the old wizard as the main product: rejected because it would reintroduce duplicate execution paths.
- Keep both paths alive: rejected because it guarantees future regressions and mismatched behavior.

---

## 2. Specialized Migrations vs Generic Column Intersection

**Decision**: Use specialized migration definitions for business-critical entities and reserve generic mapped migration for truly direct-copy tables.

**Rationale**:
- Generic migration based only on intersecting column names loses transformed fields and derived writes.
- Customers, products, subscriptions, and related records require domain mapping rather than blind copy.
- A specialized registry gives one place to declare which source entities need transform logic, auxiliary lookups, image resolution, and child-table writes.

**Alternatives considered**:
- Expand generic mapping with more heuristics only: rejected because heuristics alone cannot encode business transforms safely.
- Hard-code special cases scattered across IPC handlers: rejected because it becomes unmaintainable quickly.

---

## 3. Product Images and Price Lines

**Decision**: Restore product migration logic as an active specialized path with two image sources and explicit price-line migration.

**Rationale**:
- Product images may exist in either an external image folder or source database image storage.
- Product price rows are a separate operational data set and cannot be inferred from the product row alone.
- The previous specialized logic already encodes useful matching behavior and should be adapted rather than lost.

**Alternatives considered**:
- Treat image migration as optional best-effort only: rejected because the feature requirement now explicitly includes image completeness.
- Ignore price lines in v1: rejected because the user asked for “everything,” including image/data completeness.

---

## 4. Customer Deduplication

**Decision**: Activate `DedupFilter` only for entities with a known unique business key and fail fast when that key cannot be derived safely.

**Rationale**:
- Duplicate prevention is a business rule, not just a database side effect.
- Counting on target-side uniqueness violations is not sufficient because the app must log what was skipped and why.
- Failing fast is safer than silently proceeding when the app cannot determine a uniqueness basis.

**Alternatives considered**:
- Use `INSERT IGNORE` alone to deduplicate: rejected because it hides whether rows were ignored, inserted, or rolled back.
- Always deduplicate on `id`: rejected because source IDs are not always the real business uniqueness rule.

---

## 5. Latest Subscription Selection

**Decision**: Activate `LatestSubscriptionFilter` on the live path and require an explicit date field and tie-break rule.

**Rationale**:
- The app must guarantee one latest subscription per customer, not merely copy all available rows.
- Tie-breaking by highest identifier is deterministic and matches the revised specification.
- If no usable date field exists, stopping before partial writes is safer than inconsistent subscription state.

**Alternatives considered**:
- Keep all subscriptions and rely on downstream app logic: rejected because it violates the migration requirements.
- Choose latest row by ID only: rejected because it does not satisfy the “latest by date” rule.

---

## 6. Trustworthy Counters and Logs

**Decision**: Count only committed results and distinguish attempted writes from persisted writes.

**Rationale**:
- `INSERT IGNORE` can silently drop rows without throwing, so success counters must inspect actual write results.
- If a batch rolls back, any optimistic per-row success accounting becomes false.
- Final summaries are part of product trust, not just diagnostics.

**Alternatives considered**:
- Keep current optimistic counters for speed: rejected because correctness is more important than superficial progress smoothness.
- Log only batch-level outcomes: rejected because row-level traceability is required for skipped/failing records.

---

## 7. Schema Analysis Strategy

**Decision**: Keep schema analysis for discovery, but extend it to classify tables by migration mode: direct-copy, specialized, unsupported, or skipped.

**Rationale**:
- Discovery is still useful for user visibility and table inventory.
- The current “exists in target + column intersection” model is too weak to decide migration safety.
- Classifying migration mode enables the UI to set correct expectations before the user starts migration.

**Alternatives considered**:
- Remove schema analysis and rely on hard-coded groups only: rejected because the app still needs visibility into what exists in source and target.

