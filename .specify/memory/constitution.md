<!--
Sync Impact Report
- Version change: template/unversioned -> 1.0.0
- Modified principles:
  - Template Principle 1 -> I. Context Before Change
  - Template Principle 2 -> II. Active Runtime First
  - Template Principle 3 -> III. Safe Migration Integrity
  - Template Principle 4 -> IV. Spec-Code Synchronization
  - Template Principle 5 -> V. Verifiable Delivery
- Added sections:
  - Operational Constraints
  - Workflow & Review Gates
- Removed sections:
  - None
- Templates requiring updates:
  - ✅ updated .specify/templates/plan-template.md
  - ✅ updated .specify/templates/spec-template.md
  - ✅ updated .specify/templates/tasks-template.md
  - ✅ updated docs/AI_PROJECT_BRIEF.md
- Follow-up TODOs:
  - None
-->
# Laundry DB Constitution

## Core Principles

### I. Context Before Change
Every task MUST begin with context loading before analysis or implementation.
An agent MUST read `AGENTS.md`, `docs/AI_PROJECT_BRIEF.md`, the active
Speckit feature artifacts, and the relevant runtime code before making
architectural, schema, or implementation decisions. No code edit, migration
change, or planning output is valid if it is based on assumptions that were not
checked against repository files.

Rationale: this repository contains active and legacy paths, so skipping context
creates incorrect fixes and stale documentation.

### II. Active Runtime First
The official runtime path MUST be treated as `laundry-migrator/` together with
its active `src/` and `renderer/` flows unless code proves otherwise. Legacy or
specialized logic under `laundry-migrator/migration/` MUST be treated as a
business-rule reference, not as an automatic execution path. Any reuse,
refactor, or migration of legacy logic MUST explicitly document how the active
runtime is affected.

Rationale: the project's main risk is split behavior between the live runtime
and older specialized implementations.

### III. Safe Migration Integrity
Any change touching migration behavior, field mapping, schema translation, or
data loading MUST preserve correctness before convenience. Agents MUST verify
source and target schemas, inspect real mappings, avoid silent data loss, avoid
optimistic success counters, and preserve specialized business rules such as
deduplication, latest-only logic, image handling, pricing details, and settings
semantics.

Rationale: migration defects in this repository directly affect production data
integrity and user trust.

### IV. Spec-Code Synchronization
Active Speckit artifacts MUST describe the current implementation reality.
Whenever behavior, architecture, workflow, or migration assumptions change, the
relevant `spec.md`, `plan.md`, `tasks.md`, contracts, and guidance documents
MUST be reviewed and updated. Agents MUST prefer updating the active feature
artifacts over creating duplicate or competing specifications.

Rationale: the project must operate from one authoritative workstream rather
than drift between code and planning documents.

### V. Verifiable Delivery
Meaningful work MUST end in verification, not only edits. Each implementation
or documentation change MUST define or execute an appropriate validation step:
schema review, syntax checks, targeted runtime checks, quickstart scenario
verification, or documented manual validation. If full validation cannot be
performed, the remaining risk MUST be stated explicitly.

Rationale: professional delivery requires observable evidence that behavior
matches intent.

## Operational Constraints

- The active feature directory for current work is `specs/001-db-migration-tool/`.
- `specs/001-mysql-data-migration/` is historical context and MUST NOT replace
  the active feature unless a task explicitly requires comparison.
- Migration changes are high-impact and MUST be reviewed against real source and
  target schemas before implementation.
- Documentation changes MUST stay practical, repository-specific, and aligned
  with the codebase.
- Agents MUST preserve the existing repository structure unless a change plan
  explicitly justifies restructuring.

## Workflow & Review Gates

The default repository workflow is:

1. `specify`
2. `clarify`
3. `plan`
4. `tasks`
5. `implement`
6. `analyze`
7. `converge`

Required gates:

- Before planning: confirm the active feature, active runtime path, and relevant
  code locations.
- Before implementation: confirm that requested behavior is reflected in the
  active feature artifacts or update them as part of the task.
- Before closing work: run or describe validation, then state any remaining
  follow-up or risk.
- Before introducing complexity: justify why a simpler change to the current
  active runtime path would not satisfy the requirement.

## Governance

This constitution overrides informal project habits when they conflict. Changes
to this constitution MUST be documented, reviewed for downstream template and
guidance impact, and versioned using semantic versioning:

- MAJOR: removing or redefining a governing principle in a backward-incompatible
  way
- MINOR: adding a new principle or materially expanding repository obligations
- PATCH: clarifications, wording improvements, or non-semantic refinements

Compliance review expectations:

- Every substantial task MUST be checked against these principles during
  planning and again before completion.
- Any deviation MUST be explicitly justified in the active plan artifacts.
- Runtime guidance in `AGENTS.md` and `docs/AI_PROJECT_BRIEF.md` MUST remain
  consistent with this constitution.

**Version**: 1.0.0 | **Ratified**: 2026-06-24 | **Last Amended**: 2026-06-24
