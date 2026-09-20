# Measuring review usefulness

Run `npm run report:review-quality -- /absolute/path/labels.json`. With no input, the report says `not_started` and returns null rates. The command is offline: no model calls, source upload, telemetry or automatic publication.

Record operator-consented, manually adjudicated cases in a private file:

```json
{
  "schemaVersion": 1,
  "cases": [{
    "id": "synthetic-example-only",
    "complete": false,
    "findings": [{"id": "finding-1", "verdict": "unresolved"}],
    "knownDefects": ["seeded-defect-1"],
    "detectedKnownDefects": []
  }]
}
```

Allowed finding verdicts are `actionable`, `false_positive`, and `unresolved`. Use human reasons and a second reviewer in the private adjudication record; do not infer correctness from accepted model suggestions or merged PRs. Preserve missed defects and inconclusive cases. Do not put source, keys, customer names or raw review text in this input.

The report shows actionability among adjudicated findings, unresolved counts, complete/incomplete reviews and recall against explicitly supplied known defects. Omit `knownDefects` when no independent ground truth exists; that case is reported as unmeasured, not as perfect recall. Empty known-defect sets provide no positive recall evidence. Repeated case IDs, duplicate finding IDs and invented detected-defect IDs are rejected. Case and defect identifiers are omitted from the aggregate output.

These statistics support product investigation. They are not a representative benchmark, causal claim, model-quality guarantee or comparison with another product. Record repository/time split, model and engine versions, prompt policy, budget, retries, adjudication protocol and sampling independently before a research experiment. See [the paper plan](technical-paper-plan.md).
