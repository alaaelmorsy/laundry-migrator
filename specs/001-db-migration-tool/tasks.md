# Tasks: Laundry DB Migration Tool Migration Fixes

**Input**: Design documents from `/specs/001-db-migration-tool/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/ipc-contracts.md`, `quickstart.md`

**Tests**: No mandatory TDD suite was requested in the specification. Validation tasks below use the scenarios in `quickstart.md`.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently on the current Electron runtime path in `laundry-migrator/`.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align documentation and runtime entry points with the active code path before changing migration behavior

- [X] T001 Update migration implementation notes in `laundry-migrator/package.json`
- [X] T002 Refresh preload/API usage notes in `laundry-migrator/preload.js`
- [ ] T003 [P] Document active runtime assumptions in `specs/001-db-migration-tool/quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the shared migration infrastructure that all stories depend on

**CRITICAL**: No user story work should start before this phase is complete

- [X] T004 Create specialized migration registry in `laundry-migrator/src/migration/specialized-registry.js`
- [X] T005 [P] Create specialized migration executor in `laundry-migrator/src/migration/specialized-executor.js`
- [X] T006 [P] Extend schema classification rules in `laundry-migrator/src/db/schema-analyzer.js`
- [X] T007 Route direct-copy versus specialized migrations in `laundry-migrator/src/ipc/migration-handlers.js`
- [X] T008 Persist committed batch metrics shape in `laundry-migrator/src/db/batch-executor.js`
- [X] T009 Surface migration mode metadata in the active UI in `laundry-migrator/renderer/js/app.js`

**Checkpoint**: The app can analyze entities, label them as `direct-copy` or `specialized`, and route future execution through one active path.

---

## Phase 3: User Story 1 - Reliable And Safe Connections (Priority: P1)

**Goal**: Keep connection setup reliable while ensuring saved settings never persist passwords

**Independent Test**: Follow Quickstart Scenario 1 and confirm host/port/user/database reload while password fields stay empty.

- [ ] T010 [US1] Validate in-memory-only password handling in `laundry-migrator/src/db/connection-manager.js`
- [X] T011 [P] [US1] Harden save/load config sanitization in `laundry-migrator/src/ipc/config-handlers.js`
- [ ] T012 [US1] Align connection bootstrapping and saved config loading in `laundry-migrator/main.js`
- [X] T013 [US1] Render restored connection fields without persisted passwords in `laundry-migrator/renderer/js/app.js`

**Checkpoint**: Connection settings are reusable across app restarts without storing passwords on disk.

---

## Phase 4: User Story 2 - Complete Specialized Data Migration (Priority: P1)

**Goal**: Restore business-specific migration behavior so transformed fields, product images, and product price rows migrate completely

**Independent Test**: Run Quickstart Scenarios 2 and 3 and verify products, images, and price rows appear correctly in the target database.

- [X] T014 [P] [US2] Create product asset resolution helpers in `laundry-migrator/src/migration/asset-resolver.js`
- [X] T015 [P] [US2] Port product field and child-write transforms into `laundry-migrator/src/migration/product-migration.js`
- [X] T016 [US2] Reuse legacy product migration rules from `laundry-migrator/migration/products.js` inside `laundry-migrator/src/migration/product-migration.js`
- [X] T017 [US2] Register products as a specialized migration in `laundry-migrator/src/migration/specialized-registry.js`
- [X] T018 [US2] Execute specialized product migration flow from `laundry-migrator/src/migration/specialized-executor.js`
- [X] T019 [US2] Collect specialized migration options and status messaging in `laundry-migrator/renderer/js/app.js`

**Checkpoint**: The active UI path can run the products migration and preserve transformed fields, images, and price lines.

---

## Phase 5: User Story 3 - Prevent Duplicates And Keep Latest Subscription Only (Priority: P1)

**Goal**: Enforce customer deduplication and latest-subscription selection as part of the active migration path

**Independent Test**: Run Quickstart Scenarios 4 and 5 and verify one customer record per identity and one latest subscription per customer.

- [X] T020 [P] [US3] Port customer transformation rules into `laundry-migrator/src/migration/customer-migration.js`
- [X] T021 [P] [US3] Port subscription selection rules into `laundry-migrator/src/migration/subscription-migration.js`
- [X] T022 [US3] Activate approved unique-key dedup filtering in `laundry-migrator/src/migration/dedup-filter.js`
- [X] T023 [US3] Activate latest-by-date plus tie-break filtering in `laundry-migrator/src/migration/latest-subscription.js`
- [X] T024 [US3] Register customers and subscriptions in `laundry-migrator/src/migration/specialized-registry.js`
- [X] T025 [US3] Enforce blocking integrity rules and skipped-row reasons in `laundry-migrator/src/migration/specialized-executor.js`

**Checkpoint**: Duplicate customers are skipped intentionally and only the latest subscription is written for each customer.

---

## Phase 6: User Story 4 - Trustworthy Results And Reviewable Logs (Priority: P2)

**Goal**: Make progress, totals, and exported logs match committed database outcomes instead of optimistic attempts

**Independent Test**: Run Quickstart Scenarios 7 and 8 and compare UI totals, exported logs, and real target row counts.

- [X] T026 [P] [US4] Count only committed inserts and classified skips in `laundry-migrator/src/db/batch-executor.js`
- [X] T027 [P] [US4] Emit row-level and summary log events in `laundry-migrator/src/migration/log-writer.js`
- [X] T028 [US4] Aggregate truthful session and group totals in `laundry-migrator/src/ipc/migration-handlers.js`
- [X] T029 [US4] Render committed progress, skip/fail totals, and export actions in `laundry-migrator/renderer/js/app.js`
- [X] T030 [US4] Ensure exported session logs include audit-ready outcomes in `laundry-migrator/src/ipc/config-handlers.js`

**Checkpoint**: The app reports only committed results and exports a session log that explains inserted, skipped, failed, and rolled-back work.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup across all user stories

- [X] T031 [P] Reconcile group construction with specialized registry dependencies in `laundry-migrator/src/migration/group-builder.js`
- [X] T032 [P] Run syntax validation for active runtime files from `laundry-migrator/package.json`
- [ ] T033 Validate Quickstart Scenarios 1 through 8 and record outcomes in `specs/001-db-migration-tool/quickstart.md`
- [X] T034 Review user-facing migration copy for unsupported/skipped entities in `laundry-migrator/renderer/index.html`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1: Setup**: No dependencies.
- **Phase 2: Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3: US1**: Depends on Phase 2 only.
- **Phase 4: US2**: Depends on Phase 2 only.
- **Phase 5: US3**: Depends on Phase 2 and builds on the specialized migration path from US2.
- **Phase 6: US4**: Depends on Phase 2 and should be completed after the migration paths in US2 and US3 are active.
- **Phase 7: Polish**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1**: Independent after Foundational completion.
- **US2**: Independent after Foundational completion.
- **US3**: Depends on the specialized execution framework from US2.
- **US4**: Depends on active migration flows from US2 and US3 to produce truthful totals.

### Within Each User Story

- Registry and routing changes before entity-specific execution.
- Entity-specific migration logic before UI wiring.
- Counting and log classification before final summary rendering.

## Parallel Opportunities

- `T003`, `T006`, `T008`, and `T009` can run in parallel during early setup/foundation work.
- `T014` and `T015` can run in parallel for product specialization.
- `T020` and `T021` can run in parallel for customer and subscription specialization.
- `T026` and `T027` can run in parallel for truthful counting and logging.
- `T031` and `T032` can run in parallel during polish.

## Parallel Example: User Story 2

```bash
Task: "T014 Create product asset resolution helpers in laundry-migrator/src/migration/asset-resolver.js"
Task: "T015 Port product field and child-write transforms into laundry-migrator/src/migration/product-migration.js"
```

## Parallel Example: User Story 3

```bash
Task: "T020 Port customer transformation rules into laundry-migrator/src/migration/customer-migration.js"
Task: "T021 Port subscription selection rules into laundry-migrator/src/migration/subscription-migration.js"
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete US1 to keep connection handling safe and stable.
3. Complete US2 to restore complete product migration on the active runtime path.
4. Validate Scenarios 1 through 3 before expanding scope.

### Incremental Delivery

1. Build the shared specialized migration path.
2. Restore products and assets.
3. Add deduplication and latest-subscription rules.
4. Make reporting and logs trustworthy.
5. Finish with full quickstart validation.

### Suggested MVP Scope

- **Recommended MVP**: Phase 1, Phase 2, Phase 3, and Phase 4.
- This delivers safe connections plus complete specialized product migration, which addresses the most visible data-loss risk first.

## Notes

- All tasks follow the required checklist format with IDs, optional `[P]`, story labels where needed, and explicit file paths.
- Legacy files under `laundry-migrator/migration/` are treated as source material to be adapted into the active `laundry-migrator/src/` runtime path, not revived as a second execution path.
