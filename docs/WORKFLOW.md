# Project Workflow

This document defines the working workflow for contributors and AI agents in
`laundry_db`.

## Working Sequence

The default operating model for this repository is:

1. Read repository guidance
2. Read active Speckit artifacts
3. Inspect the real runtime code
4. Identify active path versus legacy/reference path
5. Plan the change
6. Implement the change
7. Verify the result
8. Update affected documentation

## Mandatory Read Order

Before any meaningful work:

1. `AGENTS.md`
2. `docs/AI_PROJECT_BRIEF.md`
3. `.specify/memory/constitution.md`
4. `specs/001-db-migration-tool/plan.md`
5. `specs/001-db-migration-tool/spec.md`
6. `specs/001-db-migration-tool/tasks.md`
7. Any directly relevant code under `laundry-migrator/`

## Speckit Workflow

Use this sequence when feature work is being created or maintained:

1. `specify`
2. `clarify`
3. `plan`
4. `tasks`
5. `implement`
6. `analyze`
7. `converge`

Rules:

- Prefer updating the active feature instead of opening a parallel one.
- If the code and the artifacts disagree, fix that disagreement explicitly.
- Do not leave `plan.md` or `tasks.md` stale after behavior changes.

## Runtime Path Rule

The active runtime path is:

- `laundry-migrator/`
- `laundry-migrator/src/`
- `laundry-migrator/renderer/`

The legacy/reference path is:

- `laundry-migrator/migration/`

Before changing logic, always decide which path actually controls current
behavior.

## Migration Change Checklist

Use this checklist for any migration-related task:

- identify source schema fields
- identify target schema fields
- verify the actual runtime code path
- inspect any legacy rule that may still carry business meaning
- verify counters, logging, and committed-result reporting
- define how the change will be validated
- update active Speckit artifacts if assumptions changed

## Documentation Update Rule

Update documentation whenever a change affects:

- architecture
- workflow
- active/legacy path understanding
- migration assumptions
- settings mapping
- verification expectations

Commonly affected files:

- `AGENTS.md`
- `docs/AI_PROJECT_BRIEF.md`
- `docs/WORKFLOW.md`
- `docs/DONE_CHECKLIST.md`
- `.specify/memory/constitution.md`
- active artifacts under `specs/001-db-migration-tool/`

## Definition Of Done

Work is not complete until:

- the change is implemented
- the affected runtime path is verified
- validation is run or clearly documented
- related Speckit/docs updates are made when needed
- any residual risks are stated explicitly
