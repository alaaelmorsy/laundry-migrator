# Done Checklist

Use this checklist before considering a task complete in `laundry_db`.

## Context

- [ ] I read `AGENTS.md`
- [ ] I read `docs/AI_PROJECT_BRIEF.md`
- [ ] I read `docs/WORKFLOW.md`
- [ ] I checked the active feature artifacts
- [ ] I confirmed the active runtime path versus any legacy/reference path

## Change Safety

- [ ] I identified the files that actually control the current behavior
- [ ] I checked whether migration logic or schema mapping is affected
- [ ] I reviewed source and target field mappings where relevant
- [ ] I checked for data integrity, logging, and counter/reporting implications

## Verification

- [ ] I ran an appropriate verification step or documented why it could not be run
- [ ] I stated any remaining risk clearly

## Documentation

- [ ] I updated related documentation if behavior or assumptions changed
- [ ] I updated active Speckit artifacts if they became stale

## Completion

- [ ] The result matches the requested behavior
- [ ] The repository is clearer after the change, not more ambiguous
