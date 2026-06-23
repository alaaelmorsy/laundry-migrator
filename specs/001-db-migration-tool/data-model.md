# Data Model: Laundry DB Migration Tool Migration Fixes

**Phase**: 1 — Design
**Date**: 2026-06-24

---

## 1. ConnectionConfig

Represents one database endpoint used by the migration app.

**Fields**
- `role`: source | target
- `host`
- `port`
- `user`
- `password`
- `database`
- `status`
- `errorMessage`

**Rules**
- Password exists in memory only during the active session.
- Persisted settings exclude `password`.

---

## 2. MigrationDefinition

Represents how one business entity should be migrated.

**Fields**
- `id`: stable migration identifier
- `label`: user-facing name
- `sourceEntities`: one or more source tables/files/providers
- `targetEntities`: one or more target tables
- `mode`: direct-copy | specialized | skipped | unsupported
- `requiresImages`: boolean
- `requiresChildWrites`: boolean
- `requiresDedup`: boolean
- `requiresLatestOnly`: boolean
- `dependsOn`: other migration definition ids

**Purpose**
- Distinguishes business-critical migrations from raw table copies.
- Allows the app to route a selected migration through the correct execution path.

---

## 3. SpecializedMigrationContext

Represents all derived inputs needed by a specialized migration.

**Fields**
- `sourceConfig`
- `targetConfig`
- `sourceSchemaSnapshot`
- `targetSchemaSnapshot`
- `externalAssetSources`
- `lookupData`
- `derivedMappings`

**Examples**
- product image folder listing
- source image rows
- package and price lookup tables
- customer uniqueness key choice
- subscription date field choice

---

## 4. MigrationBatchResult

Represents the outcome of one processed batch after commit or rollback resolution.

**Fields**
- `attempted`
- `inserted`
- `skipped`
- `failed`
- `rolledBack`
- `durationMs`
- `warnings`

**Rules**
- `inserted` counts only rows that remained persisted after commit.
- `rolledBack` rows are never counted as inserted.
- ignored rows must be classified into `skipped` or `failed`, never hidden inside attempted totals.

---

## 5. MigrationSession

Represents one end-to-end execution of the migration app.

**Fields**
- `sessionId`
- `startedAt`
- `endedAt`
- `selectedDefinitions`
- `groupResults`
- `totals`
- `logFilePath`

**Totals**
- `inserted`
- `skipped`
- `failed`
- `rolledBack`
- `durationMs`

---

## 6. LogEntry

Represents one auditable migration event.

**Fields**
- `timestamp`
- `level`: INFO | WARN | SKIP | ERROR
- `migrationId`
- `entity`
- `rowReference`
- `outcome`: inserted | skipped | failed | rolled-back | summary
- `message`
- `details`

**Rules**
- Every skipped or failed business-critical row must emit at least one log entry.
- Summary entries may aggregate committed batch outcomes, but they do not replace row-level error traceability.

---

## 7. AssetResolution

Represents how a product image or similar media file was resolved.

**Fields**
- `entityId`
- `sourceType`: folder | source-database | none
- `sourceReference`
- `mimeType`
- `resolved`: boolean
- `resolutionNote`

**Purpose**
- Makes image completeness observable and testable.

---

## 8. IntegrityRule

Represents a migration-time business integrity rule.

**Fields**
- `id`
- `entity`
- `ruleType`: dedup | latest-only | required-transform | required-child-write | required-asset
- `blocking`: boolean
- `description`
- `failureAction`: stop-before-write | skip-row | skip-entity

**Examples**
- customers must deduplicate on the approved unique key
- subscriptions must choose latest-by-date, then highest-id
- products must write price lines when price data exists

