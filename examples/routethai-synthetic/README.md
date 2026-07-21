# RouteThai synthetic shadow fixture

This fixture sanitizes one routing constraint from ChangePlane's RouteThai production use case without copying or contacting the RouteThai production repository or operational data. Every identifier, time window, and route input in this public fixture is synthetic.

The intentionally vulnerable head orders stops by heuristic priority alone. `service-window.test.js` proves that this can schedule `SYN-STOP-B` after its service window. A bounded repair proposal may change only `service-window.js`; the clean harness must pass before a trusted controller may apply the patch.

Run the deterministic evidence with:

```sh
node --test examples/routethai-synthetic/service-window.test.js
```
