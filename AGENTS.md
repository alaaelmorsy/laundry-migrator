# AGENTS.md instructions for D:\PLUS\data\laundry_db

<INSTRUCTIONS>
Read this file first, then immediately read:
1. `docs/AI_PROJECT_BRIEF.md`
2. `docs/WORKFLOW.md`
3. `specs/001-db-migration-tool/plan.md`

These files are mandatory entry points before any analysis, planning, code edits, schema changes, migration changes, or documentation work.

Operational rules for any AI agent in this repository:
- Do not implement anything before reading the required context files.
- Do not make architectural assumptions before inspecting the actual codebase.
- Treat `laundry-migrator/` as the active application path unless the code clearly proves otherwise.
- Treat `laundry-migrator/migration/` as legacy/specialized migration logic that must be reviewed carefully before changing or reusing it.
- If a task touches migration behavior, also review the active feature artifacts under `specs/001-db-migration-tool/`.
- If code changes affect behavior, keep `spec.md`, `plan.md`, `tasks.md`, and related docs aligned with reality.
- Prefer updating the active feature artifacts over creating duplicate or parallel specs.
- Before modifying database migration logic, inspect source/target field mappings and verify behavior against the real schema and runtime path.
- When instructions conflict, prefer: `AGENTS.md` -> `docs/AI_PROJECT_BRIEF.md` -> active Speckit artifacts -> actual code.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/001-db-migration-tool/plan.md`
<!-- SPECKIT END -->

</INSTRUCTIONS>
