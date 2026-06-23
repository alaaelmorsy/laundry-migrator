# IPC Contracts: Electron Main ↔ Renderer

**Type**: Internal application contracts between Electron Main and Renderer
**Date**: 2026-06-24

---

## Contract Principles

- The renderer invokes commands and receives deterministic responses.
- The main process emits progress and log events that reflect committed outcomes.
- Business-critical migrations may use specialized handlers rather than one generic table-copy command.
- Persisted counts must describe actual target-state results, not attempted writes.

---

## Invoke Channels

### `db:test`

**Purpose**: Validate credentials for one database endpoint.

**Request**
```json
{
  "host": "127.0.0.1",
  "port": 3306,
  "user": "root",
  "password": "secret"
}
```

**Response**
```json
{
  "success": true,
  "version": "5.7.x"
}
```

---

### `db:list-databases`

**Purpose**: List selectable databases after a successful low-level connection.

**Response**
```json
{
  "success": true,
  "databases": ["laundry_schema_23-06-2026_1807", "laundry_db_23-06-2026_1803"]
}
```

---

### `db:init-pools`

**Purpose**: Initialize reusable source/target pools for the active session.

**Request**
```json
{
  "src": { "host": "127.0.0.1", "port": 3306, "user": "root", "password": "secret", "database": "old_db" },
  "tgt": { "host": "127.0.0.1", "port": 3306, "user": "root", "password": "secret", "database": "new_db" }
}
```

**Response**
```json
{ "ok": true }
```

---

### `db:analyze`

**Purpose**: Return source/target inventory plus migration-mode classification.

**Response**
```json
{
  "sourceTables": [],
  "targetTables": [],
  "skippedTables": [],
  "migrationDefinitions": [
    {
      "id": "products",
      "label": "المنتجات",
      "mode": "specialized",
      "requiresImages": true,
      "requiresChildWrites": true,
      "requiresDedup": false,
      "requiresLatestOnly": false
    },
    {
      "id": "customers",
      "label": "العملاء",
      "mode": "specialized",
      "requiresDedup": true
    },
    {
      "id": "misc-direct-copy",
      "label": "جداول مباشرة",
      "mode": "direct-copy"
    }
  ]
}
```

---

### `config:save`

**Purpose**: Persist connection settings without passwords.

**Request**
```json
{
  "src": { "host": "127.0.0.1", "port": 3306, "user": "root", "database": "old_db" },
  "tgt": { "host": "127.0.0.1", "port": 3306, "user": "root", "database": "new_db" }
}
```

**Response**
```json
{ "saved": true }
```

---

### `config:load`

**Purpose**: Load saved connection settings without passwords.

---

### `migration:start-mapped`

**Purpose**: Start a safe direct-copy migration for a table or entity confirmed as direct-copy compatible.

**Request**
```json
{
  "mappingId": "map-0",
  "sourceTable": "lookup_table",
  "targetTable": "lookup_table",
  "colMap": ["id", "name"]
}
```

**Response**
```json
{
  "ok": true,
  "sessionId": "uuid",
  "logFilePath": "C:\\path\\session.log"
}
```

---

### `migration:start-specialized`

**Purpose**: Start a business-specific migration definition that may perform transforms, asset resolution, deduplication, or child-table writes.

**Request**
```json
{
  "migrationId": "products",
  "options": {
    "imageFolder": "C:\\images\\products"
  }
}
```

**Response**
```json
{
  "ok": true,
  "sessionId": "uuid",
  "logFilePath": "C:\\path\\session.log"
}
```

---

### `migration:cancel`

**Purpose**: Cancel the active migration after the current safe interruption point.

**Response**
```json
{
  "cancelled": true
}
```

---

### `log:export`

**Purpose**: Save the current session log to a user-selected destination.

---

## Push Channels

### `migration:progress`

**Purpose**: Emit live progress for the active migration.

**Payload**
```json
{
  "migrationId": "products",
  "entity": "products",
  "processedRows": 5000,
  "totalRows": 12000,
  "attempted": 5000,
  "inserted": 4800,
  "skipped": 180,
  "failed": 20,
  "rolledBack": 0,
  "rowsPerSecond": 2400,
  "estimatedRemainingMs": 3200
}
```

---

### `migration:log`

**Purpose**: Emit row-level or batch-level auditable log entries.

**Payload**
```json
{
  "timestamp": "2026-06-24T12:00:00.000Z",
  "level": "SKIP",
  "migrationId": "customers",
  "table": "io_customers→customers",
  "rowId": 145,
  "outcome": "skipped",
  "message": "Duplicate customer skipped by approved unique key"
}
```

---

### `migration:group-done`

**Purpose**: Emit committed summary for one selected migration step.

**Payload**
```json
{
  "groupId": "products",
  "status": "completed",
  "stats": {
    "attempted": 1200,
    "inserted": 1180,
    "skipped": 15,
    "failed": 5,
    "rolledBack": 0,
    "durationMs": 1800,
    "rowsPerSecond": 655
  }
}
```

---

### `migration:session-completed`

**Purpose**: Emit final totals for the full session.

**Payload**
```json
{
  "sessionId": "uuid",
  "totals": {
    "attempted": 40000,
    "inserted": 39250,
    "skipped": 600,
    "failed": 150,
    "rolledBack": 0,
    "durationMs": 45000
  },
  "logFilePath": "C:\\path\\session.log"
}
```
