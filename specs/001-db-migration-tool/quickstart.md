# Quickstart & Validation Guide: Laundry DB Migration Tool Migration Fixes

**Date**: 2026-06-24

---

## Prerequisites

- Node.js available for the Electron app
- MySQL source and target databases accessible
- The current project checkout in `D:\PLUS\data\laundry_db`
- Representative old/new laundry schemas for validation
- Optional product image folder when validating external asset migration

---

## Project Setup

```bash
cd laundry-migrator
npm install
npm run dev
```

---

## Validation Scenarios

### Scenario 1: Connection Settings Stay Safe

**Steps**
1. Open the app.
2. Test valid source and target connections.
3. Save/continue, close the app, then reopen it.

**Expected Outcome**
- Host, port, user, and database fields reload.
- Password fields remain empty.
- No password value is persisted in the app config file.

---

### Scenario 2: Specialized Product Migration Moves Images

**Setup**
- Prepare one product whose image exists in the external image folder.
- Prepare another product whose image exists only in the source image table.

**Steps**
1. Start the products migration through the active UI path.
2. Provide the image folder when required.
3. Let the migration finish.

**Expected Outcome**
- The first product receives its image from the folder source.
- The second product receives its image from the source database fallback.
- Log output makes it possible to tell whether image resolution succeeded or failed.

---

### Scenario 3: Product Price Lines Are Preserved

**Setup**
- Prepare source product-price relationships for at least two services.

**Steps**
1. Run the products migration.
2. Inspect the target product price lines.

**Expected Outcome**
- Each expected price line exists in the target.
- Product migration does not stop at the base product row and forget the related pricing data.

---

### Scenario 4: Customer Deduplication Works

**Setup**
- Insert duplicate customer rows in the source that share the approved unique business key.

**Steps**
1. Run the customers migration.
2. Count target customer rows for the duplicated identity.
3. Inspect the session log.

**Expected Outcome**
- Only one target customer record is kept for that identity.
- Duplicate rows are logged as skipped with a clear reason.

---

### Scenario 5: Latest Subscription Only

**Setup**
- Prepare one customer with multiple subscriptions on different dates.
- Prepare another customer with a tie on the same latest date.

**Steps**
1. Run customer migration if required by dependencies.
2. Run subscription migration.

**Expected Outcome**
- Only one subscription per customer exists in the target.
- The chosen row is the latest by date.
- For ties, the chosen row follows the approved deterministic tie-break rule.

---

### Scenario 6: Generic Direct-Copy Tables Still Work

**Setup**
- Select a small lookup-style table where source and target are genuinely direct-copy compatible.

**Steps**
1. Run the direct-copy migration path from the active UI.
2. Compare source and target values.

**Expected Outcome**
- Compatible simple tables still migrate successfully without needing specialized logic.
- This path is not used for entities that require transforms or child writes.

---

### Scenario 7: Counters Match Committed Results

**Setup**
- Prepare a migration batch containing:
  - rows that insert successfully
  - rows that should be skipped
  - rows that trigger a rollback or fail

**Steps**
1. Run the migration.
2. Compare UI totals, exported log totals, and actual target row counts.

**Expected Outcome**
- Inserted/skipped/failed totals match the actual target state.
- Rolled-back rows are never reported as inserted.
- Silent ignored rows are classified rather than counted as success.

---

### Scenario 8: Log Export Supports Audit Review

**Steps**
1. Finish at least one migration step.
2. Export the session log.

**Expected Outcome**
- The log file is written successfully.
- It contains enough detail to identify why rows were inserted, skipped, or failed.

---

## References

- Specification: [spec.md](spec.md)
- Plan: [plan.md](plan.md)
- Data model: [data-model.md](data-model.md)
- IPC contracts: [contracts/ipc-contracts.md](contracts/ipc-contracts.md)
