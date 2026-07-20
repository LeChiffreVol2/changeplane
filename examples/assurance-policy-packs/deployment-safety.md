# Deployment safety

## Repository invariants

- A preview receipt may include a deployment URL only when GitHub binds it to the exact checked head SHA.
- A later commit invalidates the previous deployment receipt and starts a fresh evaluation.

## Security boundaries

- Deployment tokens and provider secrets must never enter model context or Check output.

## Compatibility commitments

- Release configuration changes remain compatible with the currently deployed revision during rollout.

## Operational checks

- Name the health check, rollout signal, and rollback owner.
- Keep preview hosting outside ChangePlane; use the repository's existing GitHub Deployment integration.

