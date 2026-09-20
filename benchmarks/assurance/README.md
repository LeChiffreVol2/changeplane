# Public assurance experiment

An executable, maintainer-run experiment using actual **QuixBugs Python tests** and separately labeled **synthetic protocol faults**. No customer data, model key or hosted account is needed. It evaluates supplied-evidence handling in ChangePlane's public collector/observation evaluator, not managed Guard publication or autonomous repair.

Read the frozen [protocol](PROTOCOL.md), [primary sources](../../docs/research/benchmark-sources.md), and [technical report](../../docs/research/technical-report.md). The published [raw records and summary](results/2026-09-20/summary.json) retain all programs, noncompletion, skips and the excluded recorder pilot.

## Reproduce the recorded protocol results offline

Use Node.js 22.18 or later from this repository:

```sh
npm run benchmark:verify
node --test benchmarks/assurance/experiment.test.mjs
```

Verification checks artifact SHA-256 hashes, both measured runs' per-test outcomes, every replay/transcript, the finite-state enumeration and every ablation. It makes no network request and does **not** rerun Python or independently reproduce its measured outcomes. To rerun those, follow the next section.

## Rerun the public Python experiments

The recorded runs use Python 3.14.6 on macOS/arm64. The signal timeout runner supports macOS/Linux; other Python/platform versions are new replications and must report their environment. Upstream programs run locally with a stripped environment, disabled automatic pytest plugins and bounded time. This is not a security sandbox for arbitrary repositories. Use a disposable environment for the named public source.

```sh
git clone https://github.com/jkoppel/QuixBugs.git /tmp/changeplane-quixbugs
git -C /tmp/changeplane-quixbugs checkout --detach 4257f44b0ff1181dedaedee6a447e133219fcebf
python3.14 -m venv /tmp/changeplane-benchmark-venv
/tmp/changeplane-benchmark-venv/bin/python -m pip install -r benchmarks/assurance/requirements.txt
/tmp/changeplane-benchmark-venv/bin/python benchmarks/assurance/collect-quixbugs.py /tmp/changeplane-quixbugs /tmp/quixbugs-first.json
/tmp/changeplane-benchmark-venv/bin/python benchmarks/assurance/collect-quixbugs.py /tmp/changeplane-quixbugs /tmp/quixbugs-repeat.json
node benchmarks/assurance/run.mjs /tmp/quixbugs-first.json outputs/assurance-first
node benchmarks/assurance/run.mjs /tmp/quixbugs-repeat.json outputs/assurance-repeat
```

Choose unused output paths; the runners refuse to overwrite a prior experiment. A complete execution is 40 programs × buggy/reference = 80 suites. Defaults preserve the upstream slow-test skips and use the same 2-second per-test/60-second per-suite limits. Compare all per-test outcomes across runs, not just totals; timing will vary. `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest benchmarks/assurance/test_collector.py` checks the timeout/error/skip recorder.

The original [QuixBugs license](https://github.com/jkoppel/QuixBugs/blob/4257f44b0ff1181dedaedee6a447e133219fcebf/LICENSE) and [provenance notes](https://github.com/jkoppel/QuixBugs/blob/4257f44b0ff1181dedaedee6a447e133219fcebf/legal_notes.txt) remain with its external checkout. No benchmark source, patch, GitHub token or customer material is vendored here. No action writes to the upstream repository.

## Interpret the result correctly

- Supplied reference programs are not ChangePlane-generated repairs. This is not a QuixBugs repair leaderboard score or SWE-bench score.
- Native GitHub controls are simulated with explicit scope and assumptions. Agreement is a useful result; unsupported advanced rules are not scored as GitHub failures.
- A protocol row may deliberately replace the measured conclusion to inject a fault. `measuredOutcome`, `effectiveEvidence`, `transformation` and the complete compressed transcript distinguish them.
- There are 40 program pairs, 14 fault/policy templates and 3,584 bounded observation configurations. Repetition does not turn these into independent real-world samples.
- Only one configuration per evaluator satisfies every Boolean condition and completed success. Positive program controls separately prevent an always-reject result from looking useful.
- Ablated evaluators are in-memory research copies. They never replace product code or grant write, Guard, approval or merge authority.
- A finite test suite and bounded enumeration cannot prove correctness, absence of unknown bugs, live concurrency safety or customer benefit.
