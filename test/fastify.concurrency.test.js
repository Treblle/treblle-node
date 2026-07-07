// Concurrency-isolation test for the Fastify adapter.
//
// The adapter opens the per-request query/metadata store with
// `AsyncLocalStorage.enterWith` from the `onRequest` hook (Fastify has no single
// callback boundary to wrap). `enterWith` is known to be leak-prone if the store
// bled across requests, so this test drives a *real* Fastify server with many
// interleaved in-flight requests and asserts every payload carries only its own
// queries and metadata.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const Fastify = require("fastify");
const { useFastifyTreblle } = require("../src/adapters/fastify");
const { trackQuery, setMetadata } = require("../index");

// Intercepts every outbound Treblle send and collects the parsed envelopes,
// keyed by the `request-id` metadata each route records.
function interceptFetch() {
  const original = globalThis.fetch;
  const byRequestId = new Map();
  globalThis.fetch = async (_url, options) => {
    let body = options.body;
    if (options.headers["Content-Encoding"] === "gzip") {
      body = zlib.gunzipSync(body).toString("utf8");
    }
    const envelope = JSON.parse(body);
    const id = envelope.data.metadata["request-id"];
    byRequestId.set(id, envelope);
    return { ok: true, status: 200, statusText: "OK" };
  };
  return {
    byRequestId,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("Fastify per-request query/metadata stores do not bleed across concurrent requests", async () => {
  const intercept = interceptFetch();

  const app = Fastify();
  useFastifyTreblle(app, { sdkToken: "sdk", apiKey: "api" });

  // Each request records its own id as metadata and a query tagged with that id.
  // A staggered delay guarantees the requests are genuinely interleaved in the
  // event loop rather than run one-at-a-time.
  app.get("/work/:id", async (request) => {
    const id = request.params.id;
    setMetadata("request-id", id);
    await new Promise((resolve) => setTimeout(resolve, (id % 5) * 4));
    trackQuery(`SELECT * FROM t WHERE id = ${id}`, 1);
    await new Promise((resolve) => setTimeout(resolve, ((id + 2) % 5) * 4));
    return { id };
  });

  await app.ready();

  const COUNT = 25;
  await Promise.all(
    Array.from({ length: COUNT }, (_, i) =>
      app.inject({ method: "GET", url: `/work/${i}` }),
    ),
  );

  // The payloads fire from the onResponse hook; give them a tick to flush.
  await new Promise((resolve) => setTimeout(resolve, 50));

  try {
    assert.equal(
      intercept.byRequestId.size,
      COUNT,
      "every request should produce exactly one payload",
    );

    for (let i = 0; i < COUNT; i++) {
      const envelope = intercept.byRequestId.get(String(i));
      assert.ok(envelope, `missing payload for request ${i}`);

      // Metadata belongs only to this request.
      assert.deepEqual(envelope.data.metadata, { "request-id": String(i) });

      // Exactly one query, and it's this request's — no bleed from neighbours.
      assert.equal(envelope.data.queries.length, 1);
      assert.equal(
        envelope.data.queries[0].sql,
        `SELECT * FROM t WHERE id = ?`,
      );
    }
  } finally {
    await app.close();
    intercept.restore();
  }
});
