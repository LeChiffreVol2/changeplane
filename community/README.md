# ChangePlane public runtime

Assess PR evidence locally or in GitHub Actions, then add repository coordination when needed. The CLI, public Action and MCP servers use Node built-ins; they share the deterministic evaluator with the managed runtime.

| Task | Entry point |
| --- | --- |
| Try an offline assessment | `node bin/changeplane.js evaluate examples/community/satisfied.json --format text` from the runtime root |
| Prepare one repository | `node bin/changeplane.js init OWNER/REPO --dry-run` |
| Inspect a real PR | `node bin/changeplane.js inspect OWNER/REPO PR_NUMBER` |
| Give an agent read-only access | `node bin/changeplane.js mcp`, with `CHANGEPLANE_REPOSITORY` set by the operator |
| Use the public GitHub Action | `LeChiffreVol2/changeplane/community@FULL_REVIEWED_SHA` |
| Coordinate parallel agents | [Operator setup](../docs/team-operator.md); separate `team-mcp.js` entrypoint |

[Installation and setup](../docs/community.md) · [Consumer skill](../skills/changeplane/SKILL.md) · [Documentation map](../docs/README.md)

The repository-root Action is the managed Guard, not this public read-only Action. Keep the `/community` subpath and a full reviewed commit pin. The public result is advisory; it cannot publish Guard or authorize repair/merge.

These entrypoints are available in current source and commit-addressed CI bundles. Older tagged assets stay immutable; check the bundled README and `SOURCE.json` before using a newer command. There is no published npm-registry installation route.

For contributors: `core.js` adapts the shared evaluator; `github.js` and `gitlab.js` collect bounded observations; `setup.js` prepares reviewed configuration; `team*.js` implement cooperative task/workspace state. CLI and MCP are adapters over those modules. Run `node --test community/*.test.js` from the runtime root.
