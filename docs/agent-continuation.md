# Start once and follow the same PR

Current source adds one read-only onboarding entry point and an optional bounded notification bridge to an existing Codex task. Use a CI-verified current-source installation; immutable older 0.4.1 assets may lack these commands. Check `changeplane runtime`.

## Reach the first assessment

```sh
changeplane onboard OWNER/REPO PR_NUMBER --format text
```

This checks the runtime, repository access and trusted policy, then assesses the PR immediately when prerequisites are present. Missing policy returns observed CI candidates. The owner identifies the meaningful behavioral job; repeat with `--check JOB --workflow .github/workflows/ci.yml` to obtain complete setup file contents for one protected configuration PR. Existing policy is preserved. The command never writes repository files or opens/merges a PR; the existing authorized agent performs that Git workflow.

After the configuration PR merges, repeat the original command without selection flags. It reads the new default-branch policy and assesses the current PR. `onboarding.assessed: true` means current-PR evidence was collected, including failing assessments; it does not mean CI passed. A configuration plan is pending setup. The same entry point is `changeplane_onboard` in read-only stdio MCP. `inspect`, `doctor`, `init` and optional review `follow` remain available.

## Read the next step

You can supply `https://github.com/OWNER/REPO/pull/NUMBER` instead of the repository and number. The website's **Set up with your agent** prompt accepts the same link; it only fills the task locally, without connecting an account or inspecting a repository.

Text output leads with the current state, responsible role and one action. CLI JSON, stdio MCP and the hosted workspace share that presentation; the complete evidence and authority fields remain available.

| Observation | Next step |
| --- | --- |
| CI is pending | Wait for it to finish, then refresh the assessment. |
| A check failed | The assigned agent diagnoses the check before proposing a code change. |
| CI permission/configuration needs attention | The repository operator investigates the CI setup. |
| Protected files changed | A repository reviewer inspects them on GitHub. |
| Evidence is stale | Read current evidence before acting on any previous result. |
| Declared evidence is current | Continue through GitHub's existing review and merge requirements. |

An ordinary assessment hands back to `onboard`. `follow` is reserved for a selected review pipeline; reading CI does not require enabling model review. These are presentation and routing behaviors covered by local tests, not measured reductions in user effort or broader hosted qualification.

## Notify the existing Codex task

This is opt-in operator work. Identify the exact **existing task UUID** assigned to this repository/PR and authorize notifications for its existing scope. A UUID is a destination, not proof of assignment or edit permission. Keep the reader and its credentials outside the coding sandbox; this bridge does not create that isolation.

Set `CHANGEPLANE_CODEX_BIN` to the absolute trusted Codex executable supporting `codex queue --thread UUID --message TEXT`. Set `CHANGEPLANE_STATE_DIR` to an absolute private operator directory outside the target checkout. The reader uses existing read-only `GH_TOKEN`/`GITHUB_TOKEN` if needed. Check the installed client's `queue --help`; credentials stay out of arguments and chat.

```sh
changeplane watch OWNER/REPO PR_NUMBER --codex-thread EXISTING_TASK_UUID
```

The foreground process polls every 30 seconds for at most 15 minutes, including while setup or CI is pending. An actionable observation queues a fixed notice asking that task to read fresh evidence. A new head is assessed afresh; successful current evidence queues its notice and ends the watch. Protected changes remain human decisions. Completion is not proof of repair, review, agent execution or merge.

The bridge uses the native client's queue command. It creates no agent or writer and never calls `exec resume` or changes model, sandbox, approvals or task scope. Notices contain the selected repository/PR link, a digest and fixed instructions. Source, paths, comments, findings, logs and GitHub/model/controller secrets are not passed to the client subprocess. The client retains its own local configuration/authentication; this is not a sandbox or credential-security proof.

Keep the operator process running with the supervision already available on that machine. ChangePlane installs no background service. Codex controls consuming notices and executing the task. A successful CLI exit is recorded only as `queued`; `agentExecutionConfirmed` remains false. Execution with a closed app or stopped daemon is not guaranteed. ChatGPT's remote integration remains read-only and cannot register this destination or start the local watcher.

## Restart, stop and recover

- **Restart:** repeat the command with the same private directory. The original deadline, notification IDs and read budget survive. One PR binds to one task in that directory; a different destination is rejected.
- **Limits:** two native notifications, 600 reader calls and 900 seconds per watch. HTTP retries retain existing per-reader bounds/rate-limit handling. `--seconds 1–900` shortens the first window. These are notification bounds, not a repair campaign or a token-spend guarantee for the existing agent.
- **Renew:** after completion/expiry, `--renew` deliberately starts a newly authorized bounded watch. It cannot bypass uncertain delivery or change the destination. Do not auto-renew indefinitely from an agent prompt.
- **Unknown delivery:** intent is saved before dispatch. A timeout, interrupted invocation or missing acknowledgement stops the watcher. Inspect the native task/queue before any resend. After stopping the watcher and resolving delivery, the operator may remove its private `watch-*/` directory to reset it.
- **Competing process or stranded lock:** inspect and stop the existing process first. Remove its lock only after proving it stopped. There is no lease expiry or automatic takeover of an unknown writer.
- **Provider/permission failure:** resolve the reported error, then resume within the original deadline. State is retained and no repository mutation occurs.
- **Stop:** Ctrl-C stops this process. It does not withdraw an accepted notice or stop an agent task; use that client's controls for those actions.

Private watch records contain repository/PR, task UUID, observation identity, delivery digests/status and limits. They use restrictive Unix permissions. Keep them outside public materials. No ChangePlane telemetry is sent.

## Evidence and limits

`node --test community/continuation.test.js` exercises setup → first assessment; pending/failing CI → updated green head; restart; identity changes; provider failures; competing processes; uncertain delivery; budgets; and credential stripping. Provider responses, time and native delivery are simulated. These are executable contract tests, not customer usability or live-forge/agent qualification. The installed CLI's queue interface was inspected; live model execution and closed-client recovery remain **unqualified**.

The next public-repository usability experiment should freeze an onboarding task, run the same coding agent with and without ChangePlane, retain failed attempts, and measure time to first assessment, human interventions and recovery. Separate necessary approvals from accidental manual work. No activation-time or competitive-superiority result is claimed here.

Official [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli) and [app-server lifecycle](https://learn.chatgpt.com/docs/app-server) describe the client-owned task lifecycle. This adapter uses the locally inspected `queue --help` interface, not app-server or a universal client contract.
