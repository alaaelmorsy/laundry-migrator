# AI Project Brief

This file is the mandatory project briefing for any AI agent working in `D:\PLUS\data\laundry_db`.

Read this file before any planning, coding, review, migration work, or documentation changes.

This briefing is governed by `.specify/memory/constitution.md` and must stay
consistent with it.

## Required Read Order

Any AI agent must read files in this order before taking action:

1. `AGENTS.md`
2. `docs/AI_PROJECT_BRIEF.md`
3. `docs/WORKFLOW.md`
4. `.specify/memory/constitution.md`
5. `specs/001-db-migration-tool/plan.md`
6. `specs/001-db-migration-tool/spec.md`
7. `specs/001-db-migration-tool/tasks.md`
8. `specs/001-db-migration-tool/research.md`
9. `specs/001-db-migration-tool/data-model.md`
10. `specs/001-db-migration-tool/quickstart.md`
11. `specs/001-db-migration-tool/contracts/ipc-contracts.md`
12. Relevant runtime code under `laundry-migrator/`

Do not skip this sequence unless the user explicitly narrows the task and the skipped files are proven irrelevant.

## Project Mission

This project centers on a laundry system migration tool. The current active feature work is focused on fixing and professionalizing the existing migration flow, not replacing it with a fresh rewrite.

The goal is to make the migration path accurate, complete, safe, auditable, and aligned with the real runtime code.

## Active Feature Context

The active Speckit feature is:

- `specs/001-db-migration-tool/`

This feature should be treated as the primary workstream unless the user explicitly directs otherwise.

There is also an older spec path:

- `specs/001-mysql-data-migration/`

Do not assume it is the active one. Only use it if the current task clearly requires historical comparison.
If it is opened, treat it as historical context only.

## Real Runtime Structure

The current application path is centered around:

- `laundry-migrator/main.js`
- `laundry-migrator/preload.js`
- `laundry-migrator/renderer/`
- `laundry-migrator/src/`

Important rule:

- Treat `laundry-migrator/` plus `laundry-migrator/src/` as the official active runtime path.
- Treat `laundry-migrator/migration/` as legacy or specialized logic that may still contain important business rules.
- Do not blindly copy logic from the legacy path into the active path without understanding the runtime wiring.

## Architectural Expectations

Before changing anything, identify:

- Which code path is active at runtime
- Which files are merely legacy references
- Which transformations are business-critical
- Which tables and fields are source-only, target-only, or mapped between both

Never make schema or migration assumptions from naming alone. Verify against code and actual schema artifacts.

## Migration Safety Rules

If the task touches migration logic, the AI agent must:

- inspect source and target schemas
- verify exact field mappings
- review the active migration execution path
- check whether logic lives in `src/` or in legacy `migration/`
- avoid silent data loss
- avoid optimistic success reporting that does not reflect committed results
- preserve specialized business rules when they exist

Any migration change must be treated as high-impact.

## Speckit Workflow

Use this workflow as the default project operating model:

1. `specify`
2. `clarify`
3. `plan`
4. `tasks`
5. `implement`
6. `analyze`
7. `converge`

Rules:

- Prefer updating the active feature artifacts instead of creating overlapping specs.
- Keep artifacts aligned with the actual codebase.
- If code and artifacts disagree, fix the disagreement explicitly.
- Do not leave plan/task documents stale after meaningful behavior changes.

## Required Agent Behavior

Before implementation, the agent must be able to summarize:

- what the active feature is
- what the official runtime path is
- what the legacy path is
- what files control the current behavior
- what risks exist for the requested change

If the agent cannot summarize that context, it has not read enough yet.

## Definition Of Professional Work In This Repo

Professional work here means:

- reading the context first
- respecting the existing architecture
- preserving business logic during migration fixes
- keeping specs and code consistent
- making safe, traceable changes
- avoiding duplicate workflows and fragmented documentation

## Documentation Update Rule

If a change affects behavior, workflow, architecture, or migration assumptions, update the relevant documentation, especially:

- `AGENTS.md`
- active Speckit artifacts
- any affected implementation notes or contracts

## Standard Response Pattern For AI Agents

Before doing substantial work, the agent should internally establish:

1. What did I read?
2. What is the active feature?
3. What is the active runtime path?
4. What is legacy?
5. What is the exact requested change?
6. What files are most likely to be affected?
7. What risks must be preserved against?

Only then should implementation begin.
