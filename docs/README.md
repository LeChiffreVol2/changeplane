# ChangePlane documentation

Start with one useful PR assessment. Add coordination when several people or agents work in the same repository.

| I want to… | Read |
| --- | --- |
| Try the product without credentials | [One-minute quickstart](../README.md#try-it-in-one-minute) |
| Install the command and inspect a repository | [Public setup guide](community.md) |
| Use ChangePlane from an agent | [Read-only MCP and skill](community.md#use-with-an-agent) |
| Coordinate my agents or a team | [Operator setup](team-operator.md) |
| Diagnose setup or an interrupted task | [Doctor and recovery](team-operator.md#recover-an-interruption) |
| Understand supported platforms and authority | [Recovery contracts](recovery-core.md) and [coordination contract](repository-team.md) |
| Contribute code | [Contributor guide](../CONTRIBUTING.md) |
| Report a vulnerability | [Security](../SECURITY.md) |

## Current operating guides

[Public runtime map](../community/README.md), [team operator](team-operator.md), [repository coordination](repository-team.md), [data handling](data-handling.md), [hosted service](hosted-service.md), [UI design](ui-design.md).

Public assessments are advisory. The root GitHub Action and managed controllers have a different authority contract from the public `/community` Action. Hosted enrollment and source repair retain their documented gates.

## Architecture and decisions

[SDLC architecture](automated-sdlc-architecture.md), [recovery core](recovery-core.md), [repository coordination](repository-team.md), [architecture decisions](adr/0009-multi-forge-assurance-boundaries.md), [competitive repository research](competitive-repository-research.md).

Research and roadmaps describe evaluated options or future work; they are not installation instructions or qualification results.

## Dated evidence and historical releases

[QA audit](open-source-qa-audit.md), [synthetic team qualification](repository-team-qualification.md), [managed canary evidence](current-release.md), [original open-source release](community-release.md), and files under `evidence/` preserve the versions and limitations that were actually observed. Their historical commands and release names are not instructions to publish or reinstall those versions.

Routine updates are identified by commit SHA. Tagged assets remain immutable. Use the README shipped with the downloaded artifact and keep all team operators/workflows on one reviewed runtime.

## Commercial and hosted planning

[Commercial plan](commercial-plan.md), [operating budget](operating-budget.md), [design-partner order form](design-partner-order-form.md), [launch measurement](launch-measurement.md). Draft commercial/legal documents do not limit the Apache-2.0 software license or grant hosted-service access.
