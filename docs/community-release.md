# Community 0.1.0-alpha.1 release verification

The first Apache-2.0 Community implementation was merged through [PR54](https://github.com/LeChiffreVol2/changeplane/pull/54) after [protected CI](https://github.com/LeChiffreVol2/changeplane/actions/runs/34380999376). Its protected source is `a0a2e0543d980ed3a0c87198bbd36c0b0dc5b5ae`. This document does not activate the hosted service or claim external adoption.

## Reproduce the package

From the release's exact committed source tree, run:

```sh
python3 scripts/package-community.py FULL_RELEASE_COMMIT_SHA /tmp/changeplane-release
```

The packager reads an explicit allowlist with `git show`, never `.env`, local credentials, databases, build output or untracked files. The archive includes first-party evaluator/runtime files, synthetic fixtures, licenses, a minimal dependency-free package manifest and `SOURCE.json` with file hashes. `SHA256SUMS` covers the archive and a customer workflow pinned to the full release SHA. These checksums detect altered downloads; they are not a third-party signature or a Guard.

CI tests the original source on Node 22, Community on Node 24, and the extracted dependency-free archive. The complete pipeline also exercises scratch PostgreSQL journal/admission/TLS behavior, Chromium onboarding journeys, production build, dependency/public-data/claim audits and the synthetic Origin contract.

## Live read-only qualification

Before publishing assets, use this documentation PR's completed `CI / verify` as real GitHub evidence with the default-branch `.changeplane.json` introduced by PR54. Run the Community CLI and Action entry point against that open PR, then inspect a same-SHA CI rerun to verify that pending work cannot inherit the earlier satisfied assessment. Record exact revisions, workflow attempts and observed results in the public release notes. A local execution of the Action entry point is not evidence of a hosted customer workflow installation.

The verification uses only this public source repository and read-only GitHub API calls. It requires no temporary repository, organization, App installation, database, model key or paid plan. The documentation change is reviewed and merged through normal protection.

## Publication and support boundary

Publish a GitHub prerelease named `community-v0.1.0-alpha.1`, attached to the final protected main SHA, with the allowlisted archive, pinned workflow, checksum manifest and bounded qualification record. Verify the downloaded bytes and public license metadata. Keep the existing hosted canary enrollment and repair gates closed; historical recovery limitations remain in [current hosted evidence](current-release.md).

Community's adoption targets begin with external users choosing to install the release. Internal CI and owner observations do not count as installations, customer-confirmed value, reliability cohorts or revenue. Use the [roadmap](community-roadmap.md) and voluntary redacted feedback to decide the next release.
