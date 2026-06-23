# Laundry DB

Professional working repository for the `laundry-migrator` desktop migration
tool and its supporting Speckit workflow.

## Purpose

This repository is focused on fixing and professionalizing the migration path
from the legacy laundry database schema into the newer target application
schema.

The current goal is not a greenfield rewrite. The goal is to make the existing
migration behavior:

- accurate
- complete
- safe for production data
- traceable
- aligned with the real runtime code

## Start Here

Any AI agent or contributor should begin with these files in order:

1. [AGENTS.md](AGENTS.md)
2. [docs/AI_PROJECT_BRIEF.md](docs/AI_PROJECT_BRIEF.md)
3. [docs/WORKFLOW.md](docs/WORKFLOW.md)
4. [constitution.md](.specify/memory/constitution.md)
5. Active feature artifacts under [specs/001-db-migration-tool](specs/001-db-migration-tool)

## Active Runtime

The official runtime path is the Electron application under:

- `laundry-migrator/main.js`
- `laundry-migrator/preload.js`
- `laundry-migrator/renderer/`
- `laundry-migrator/src/`

Legacy or specialized migration logic also exists under:

- `laundry-migrator/migration/`

That legacy path may still contain important business rules, but it must not be
treated as the default runtime path without verification.

## Active Feature

The active Speckit workstream is:

- [specs/001-db-migration-tool](specs/001-db-migration-tool)

Historical path:

- `specs/001-mysql-data-migration/`

That older path is reference-only unless a task explicitly requires comparison.

## Working Rules

- Read context before changing code.
- Verify active versus legacy execution paths before making architectural
  decisions.
- Treat migration changes as high-impact.
- Keep Speckit artifacts synchronized with the codebase.
- End substantial work with verification or an explicit validation note.

## Main Documents

- [AI Project Brief](docs/AI_PROJECT_BRIEF.md)
- [Workflow](docs/WORKFLOW.md)
- [Done Checklist](docs/DONE_CHECKLIST.md)
- [Constitution](.specify/memory/constitution.md)
- [Active Plan](specs/001-db-migration-tool/plan.md)
- [Active Tasks](specs/001-db-migration-tool/tasks.md)

## Suggested Local Validation

Common validation examples in this repository include:

- `node --check <file>`
- targeted schema-to-field mapping review
- quickstart scenario validation from the active feature docs
- focused migration-path checks inside `laundry-migrator/`
