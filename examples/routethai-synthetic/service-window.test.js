import assert from "node:assert/strict";
import test from "node:test";

import { planSyntheticStops } from "./service-window.js";

const syntheticStops = [
  { id: "SYN-STOP-A", heuristicPriority: 1, serviceWindowEndMinute: 720 },
  { id: "SYN-STOP-B", heuristicPriority: 2, serviceWindowEndMinute: 500 },
];

test("every synthetic stop is scheduled inside its service window", () => {
  const plan = planSyntheticStops(syntheticStops);
  for (const stop of plan) {
    assert.ok(
      stop.scheduledMinute <= stop.serviceWindowEndMinute,
      `${stop.id} scheduled at minute ${stop.scheduledMinute} after window ${stop.serviceWindowEndMinute}`,
    );
  }
});
