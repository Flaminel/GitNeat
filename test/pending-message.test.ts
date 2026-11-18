import assert from "node:assert/strict";
import test from "node:test";
import { getPending, pendingText, resetPending, setPending } from "../src/pendingMessage";

test("pending message joins summary and description and resets per repository", () => {
  setPending("/a", { summary: " Fix " });
  assert.equal(pendingText("/a"), "Fix");
  setPending("/a", { description: "More\ntext " });
  assert.equal(pendingText("/a"), "Fix\n\nMore\ntext");
  assert.equal(pendingText("/b"), "");
  resetPending("/a");
  assert.deepEqual(getPending("/a"), { summary: "", description: "" });
});
