import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readReviewRequest } from "../.github/extensions/mcasset-preview/reviewHttp.mjs";

const serverUrl = "http://127.0.0.1:54321/";
function request(body, headers = {}) {
  const req = Readable.from([Buffer.from(body)]);
  req.headers = { origin: "http://127.0.0.1:54321", host: "127.0.0.1:54321", "content-type": "application/json", ...headers };
  return req;
}

test("review requests accept only bounded, same-origin JSON submissions", async () => {
  const payload = { action: "approved", feedback: "", notificationId: "id-1" };
  assert.deepEqual(await readReviewRequest(request(JSON.stringify(payload)), serverUrl), payload);
  for (const headers of [{ origin: "https://example.com" }, { origin: undefined }, { host: "example.com:54321" }]) {
    await assert.rejects(readReviewRequest(request("{}", headers), serverUrl), { statusCode: 403 });
  }
  await assert.rejects(readReviewRequest(request("{}", { "content-type": "text/plain" }), serverUrl), { statusCode: 415 });
  await assert.rejects(readReviewRequest(request(" ".repeat(65537)), serverUrl), { statusCode: 413 });
  await assert.rejects(readReviewRequest(request("{"), serverUrl), { statusCode: 400 });
  await assert.rejects(readReviewRequest(request("null"), serverUrl), { statusCode: 400 });
});
