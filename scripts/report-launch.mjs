import { readFileSync, statSync } from "node:fs";
import { buildLaunchScorecard } from "../src/lib/launch-scorecard.js";

try {
  const file = process.argv[2] ?? new URL("../examples/launch-evidence.template.json", import.meta.url);
  if (statSync(file).size > 5_000_000) throw new Error("Evidence file exceeds the five-megabyte limit.");
  const scorecard = buildLaunchScorecard(JSON.parse(readFileSync(file, "utf8")));
  process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
  process.exitCode = scorecard.state === "met" ? 0 : 2;
} catch {
  // Neither malformed input nor filesystem errors may echo private evidence.
  process.stderr.write("Launch report rejected invalid evidence. Check the documented schema and private input path.\n");
  process.exitCode = 1;
}
