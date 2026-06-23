# Implementation Plan: Laundry DB Migration Tool Migration Fixes

**Branch**: `001-db-migration-tool` | **Date**: 2026-06-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-db-migration-tool/spec.md`

---

## Summary

الخطة الحالية لا تهدف إلى إنشاء أداة ترحيل جديدة من الصفر، بل إلى إصلاح مسار الترحيل القائم داخل `laundry-migrator/` حتى ينقل البيانات الفعلية المطلوبة من النظام القديم إلى النظام الجديد بدقة. محور الإصلاح هو توحيد مسار التنفيذ النشط حول ترحيلات متخصصة تحافظ على التحويلات الوظيفية، تنقل الصور والأسعار والبيانات التابعة، تمنع تكرار العملاء، تنقل أحدث اشتراك فقط لكل عميل، وتنتج سجلات وعدادات نهائية يمكن الوثوق بها.

---

## Technical Context

**Language/Version**: JavaScript (CommonJS) على Node.js 18+ مع Electron 28+

**Runtime Architecture**:
- Main Process: [laundry-migrator/main.js](../../laundry-migrator/main.js)
- Preload Bridge: [laundry-migrator/preload.js](../../laundry-migrator/preload.js)
- Active Renderer UI: [laundry-migrator/renderer/index.html](../../laundry-migrator/renderer/index.html) + [laundry-migrator/renderer/js/app.js](../../laundry-migrator/renderer/js/app.js)
- Active Migration Back End: `laundry-migrator/src/db/*`, `laundry-migrator/src/ipc/*`, `laundry-migrator/src/migration/*`
- Legacy Specialized Logic Still Present: `laundry-migrator/migration/*`

**Primary Dependencies**:
- `electron`
- `mysql2`
- built-in `fs`, `path`, `crypto`

**Storage**:
- JSON file in Electron `userData` for connection settings without passwords
- session log files under `userData/logs`

**Testing**:
- Existing ad hoc verification plus new targeted validation scenarios
- Syntax validation via `node --check`
- Functional verification against MySQL source/target databases

**Target Platform**: Windows desktop

**Performance Goals**:
- Keep batch-based migration behavior for large datasets
- Preserve responsive UI during long-running migrations
- Ensure metrics describe committed results, not attempted writes

**Constraints**:
- Must preserve existing workspace structure instead of full rewrite
- Must not regress security rule of never persisting passwords
- Must support specialized migrations where generic column intersection is insufficient
- Must not silently report success for ignored or rolled-back rows

**Scale/Scope**:
- Current focus is correctness and completeness of existing migration flow
- Scope includes products, images, product prices, customers, subscriptions, logs, and progress accounting

---

## Constitution Check

> Project constitution is still an unfilled template, so no additional project-specific gates apply.

General checks:
- ✅ Scope is bounded to migration correctness fixes in an existing app
- ✅ Measurable outcomes exist in the spec for completeness, deduplication, latest-subscription, and trustworthy counters
- ✅ No unresolved clarifications remain in the active specification

---

## Project Structure

### Documentation (this feature)

```text
specs/001-db-migration-tool/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ipc-contracts.md
└── tasks.md
```

### Active Source Code

```text
laundry-migrator/
├── main.js
├── preload.js
├── renderer/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── src/
│   ├── db/
│   │   ├── connection-manager.js
│   │   ├── schema-analyzer.js
│   │   └── batch-executor.js
│   ├── ipc/
│   │   ├── db-handlers.js
│   │   ├── config-handlers.js
│   │   └── migration-handlers.js
│   └── migration/
│       ├── dedup-filter.js
│       ├── latest-subscription.js
│       ├── group-builder.js
│       └── log-writer.js
└── migration/
    ├── customers.js
    ├── products.js
    ├── subscriptions.js
    └── ...
```

**Structure Decision**: نُبقي الواجهة النشطة الحالية (`renderer/` + `src/`) باعتبارها المسار الرسمي للتطبيق، ثم ننقل أو ندمج منطق الترحيلات المتخصصة من مجلد `migration/` القديم داخل هذا المسار بدل استمرار وجود مسارين تنفيذ مختلفين.

---

## Phase 0: Research Decisions

Phase 0 findings are captured in [research.md](research.md) and resolve the key unknowns:
- كيف ندمج الترحيلات المتخصصة داخل المسار التنفيذي النشط
- كيف ننقل الصور والأسعار دون فقدان التوافق
- كيف نجعل العدادات والسجل النهائيين يعكسان الكتابة الفعلية
- كيف نستخدم dedup/latest-only بطريقة متخصصة بدل الفلتر الفارغ

---

## Phase 1: Design Artifacts

Phase 1 outputs are:
- [data-model.md](data-model.md)
- [contracts/ipc-contracts.md](contracts/ipc-contracts.md)
- [quickstart.md](quickstart.md)

These artifacts redefine the internal migration session, specialized migration definitions, and the IPC needed for trustworthy migration progress.

---

## Implementation Phases

### Phase 2: Unify the Active Migration Path
**Goal**: Remove the split-brain behavior between generic active flow and legacy specialized logic

1. Keep `main.js`, `preload.js`, `renderer/`, and `src/` as the official runtime path
2. Introduce a specialized migration registry describing which entities require custom transforms
3. Route products, customers, subscriptions, and similar tables through specialized handlers instead of plain column intersection
4. Preserve generic mapped migration only for safe direct-copy cases

**Validation**: User can still open the app, connect, analyze, and start migration from the active UI

---

### Phase 3: Restore Specialized Entity Migration
**Goal**: Correctly migrate business-critical data that cannot be copied by matching names only

1. Move or adapt product migration logic to the active `src/` path
2. Support image resolution from external folders and fallback image tables
3. Support product price line migration
4. Restore customer transformation rules and subscription relationship logic
5. Restore latest-subscription selection behavior in the active runtime

**Validation**: Products include images and price lines after migration; transformed entities land in the correct target schema

---

### Phase 4: Enforce Deduplication and Latest-Only Rules
**Goal**: Make customer and subscription integrity part of the active execution path

1. Initialize and wire `DedupFilter` for customer-like entities
2. Initialize and wire `LatestSubscriptionFilter` for subscription-like entities
3. Fail fast when required uniqueness or latest-date inputs cannot be derived safely
4. Surface skipped-row reasons clearly in the live log and final summary

**Validation**: Duplicate customers are not duplicated in target; only the latest subscription exists per customer

---

### Phase 5: Fix Progress and Result Accounting
**Goal**: Make UI counters and logs represent committed truth

1. Replace optimistic inserted counters with committed-result accounting
2. Distinguish inserted, skipped, ignored, failed, and rolled-back records
3. Prevent `INSERT IGNORE` from being counted as success without evidence
4. Ensure group/session summaries aggregate only committed batch results

**Validation**: Final summary and database row counts match exactly in success, skip, and failure scenarios

---

### Phase 6: Verification and Safety Checks
**Goal**: Prove the fixes end-to-end on the current app path

1. Validate connection persistence behavior and password non-persistence
2. Run targeted scenarios for products/images/prices
3. Run targeted scenarios for duplicate customers and latest subscription
4. Run failure-path scenarios for ignored rows and rolled-back batches
5. Export session logs and verify traceability

**Validation**: All scenarios in [quickstart.md](quickstart.md) pass against representative data

---

## Complexity Tracking

No constitution violations identified. The main complexity is intentional: preserving the current app while consolidating specialized migration behavior into one trustworthy runtime path.
