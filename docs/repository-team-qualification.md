# Parallel repository qualification — 2026-09-10

This is an engineering canary with synthetic source and two simulated member roles. It is not customer adoption, a live Cursor/Origin installation, a real multi-person trial or a market benchmark.

Qualified runtime: `c658a9f36deb685186307ab21166a63283f091fe` (Open Source 0.3.0). The final observer used this immutable pin. Subsequent release documentation may have a different commit without changing these runtime bytes.

## Environment

- Disposable public GitHub repository `LeChiffreVol2/changeplane-team-qualification`, repository ID `1363833730`.
- Required strict `CI / behavior`, administrator enforcement enabled, force push and branch deletion disabled on `main`.
- Native GitHub auto-merge enabled by the owner. ChangePlane did not call a merge endpoint.
- Local operator qualification used the existing authenticated owner session, with credentials read inside the trusted process and never persisted in fixtures. This does not qualify GitHub App credential isolation.
- The installed observer ran with the repository-owned Actions token: Contents write; Pull requests, Actions and Checks read. It checked out only pinned ChangePlane runtime.
- No paid resources, database provisioning, Supabase changes, hosted customer activation or model calls.

## Results

| Exercise | Observed result |
| --- | --- |
| Two clients claim the same task concurrently | Exactly one succeeded; the other was rejected. No overwrite. |
| Independent API/web scopes | Two separate branches and worktrees, owned by simulated Alice and Bob. |
| Second workspace for the same task | Rejected; the original workspace reservation remained. |
| Claim work before dependencies merge | Rejected. |
| Discover PRs from task branches | PR1 and PR2 bound without a manual bind command. |
| Deliberately failing API behavior | `INSPECT_FAILURE_EVIDENCE`; assigned workspace received and acknowledged the handoff. |
| New source commit after failure | Previous handoff rejected. An initial moving-PR read was also rejected as `TEAM_REVISION_CHANGED`; no stale acknowledgement was accepted. |
| Independent web PR merges first | Native GitHub merge; API task received `UPDATE_BRANCH_FROM_DEFAULT`. |
| Same API writer updates its branch | Fresh source head and fresh behavioral CI; no second writer and no automatic rewrite of another checkout. |
| Native integration finishes | Both PRs reported merged; merge ancestry confirmed on the current default branch. |
| Dependent task becomes startable | Claimed at base `e58c2cf9c62b5aaa1e005d531cb2ab540389a408`. |
| Pinned observer on GitHub Actions | Final workflow-run event `34463792788` succeeded at synthetic main `7c68937485177449f6fbec9ea1337937db686aab`. |

The API task failed at head `d6e66fba1664b9474c711f2bb42c144ac06684f0`, was fixed at `8c8b792cd8c4fac97e2f2b731642e132ce30caff`, and integrated after branch update at `82482410f018454220e037d4d05490d21487ac91`. The web task head was `1c4736a1589b7a37ef27ace6b77f73c6fa0a7e9e`.

The first observer revision had two failed jobs (`34462825804`, `34462852564`) during moving state and competing coordination writes. These are preserved as failed qualification evidence. The final observer re-reads/recomputes once only after definite revision drift or verified ref contention. A still-moving repository remains explicitly deferred without assessment. Persistent provider/configuration failures remain failures. A non-CAS HTTP422 is not contention; an uncertain write is never retried. Cancelled pending event runs were followed by full sweeps; no schedule latency guarantee is inferred.

## Regression and release checks

- 593 unit/integration tests; 15 focused team tests within that total.
- 98 tests from the isolated dependency-free archive.
- Production build, public-data scan, release-claim scan and dependency audit (zero reported vulnerabilities).
- 13/13 Chromium onboarding journeys; the web application behavior was unchanged by this increment.
- Independent review regressions cover stale prerequisite ancestry, same-head workflow attempts, changed policy/evidence, duplicate workspace reservations, dirty checkout preservation, smudge and conditional Git filters, uncertain writes, verified ref contention and persistent HTTP422 rejection.

Reproduce the local protocol cases with `node --test community/team*.test.js`. The live exercise required a disposable GitHub repository, two task worktrees, one deliberately broken source assertion, strict native checks and the reviewed observer template. Source repairs in this exercise were driven by the test operator simulating the existing coding agents; it does not measure LLM repair quality or prove unattended Cursor operation.

## Cleanup and boundaries

The scheduled observer is disabled. Repository deletion has been requested and is awaiting GitHub owner reauthentication; completed deletion is not claimed. The repository is disposable; its run and PR identifiers are retained here as historical evidence rather than permanent live links.

The supported increment is cooperative repository coordination and assigned recovery for running clients. It does not provide abandoned-writer fencing, wake a stopped agent, prove semantic independence of separate paths, remove required human review, publish Guard, or grant merge authority. GitLab and native Origin live qualification remain outside this record. See [setup and operating limits](repository-team.md).
