# API compatibility

## Repository invariants

- Existing documented request fields keep their meaning until a versioned replacement is available.
- New response fields are additive; removals require an explicit migration contract.

## Security boundaries

- Authorization decisions stay server-side and default to deny when identity or policy is unavailable.

## Compatibility commitments

- Bind the generated schema or contract test that represents the supported public surface.
- Database migrations must support the currently deployed application revision during rollout.

## Operational checks

- Review changed API, schema, and migration lines together.
- Require a rollback or forward-fix note for destructive migrations.

