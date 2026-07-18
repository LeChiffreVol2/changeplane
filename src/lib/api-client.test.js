import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, responseJson } from "./api-client.js";

test("edge rate limits remain actionable without JSON or Retry-After", async () => {
  await assert.rejects(
    responseJson(new Response("Forbidden", { status: 429 })),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 429);
      assert.equal(error.message, "Too many ChangePlane requests. Wait about a minute, then try again.");
      return true;
    },
  );
});
