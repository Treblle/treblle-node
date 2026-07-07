const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const express = require("express");

const { useTreblle, trackQuery, setMetadata } = require("../index.js");
const { DEFAULT_MASKED_KEYWORDS } = require("../src/maskFields");

// The SDK sends payloads to *.treblle.com using the global fetch. We swap it
// out for a capturing mock that records Treblle-bound calls and delegates
// everything else (i.e. our own requests to the local app) to the real fetch.
const realFetch = globalThis.fetch;
let captured = [];

function installFetchMock() {
  globalThis.fetch = async (url, options) => {
    const u = typeof url === "string" ? url : url && url.url;
    if (u && u.includes("treblle.com")) {
      // Mirror what the real ingest endpoint does: decompress when the SDK
      // sends a gzipped body (large payloads), otherwise parse the string.
      const headers = options.headers || {};
      const encoding =
        headers["Content-Encoding"] || headers["content-encoding"];
      const rawBody =
        encoding === "gzip"
          ? zlib.gunzipSync(options.body).toString("utf8")
          : options.body;
      captured.push({
        url: u,
        options,
        headers: options.headers,
        payload: JSON.parse(rawBody),
      });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
        text: async () => "",
      };
    }
    return realFetch(url, options);
  };
}

/**
 * Polls until at least `count` Treblle payloads have been captured, or throws
 * on timeout. The SDK sends fire-and-forget on the response "finish" event, so
 * capture happens shortly after the client receives its response.
 */
async function waitForCaptured(count = 1, timeoutMs = 2000) {
  const start = Date.now();
  while (captured.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for ${count} Treblle payload(s); got ${captured.length}`,
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  return captured;
}

let server;
let baseUrl;

before(async () => {
  installFetchMock();

  const app = express();
  app.use(express.json());

  useTreblle(app, {
    sdkToken: "sdk_test_token",
    apiKey: "proj_test_key",
    // Extend the built-in defaults with a custom field (spread pattern).
    maskedKeywords: [...DEFAULT_MASKED_KEYWORDS, "secretNote"],
  });

  app.post("/users/:id", (req, res) => {
    res.json({ created: true, password: "responseSecret", secretNote: "hush" });
  });
  // Mimics a multer upload middleware: text fields land on req.body, the file
  // on req.files. Treblle should fold in a descriptor, not the raw bytes.
  const fakeMulter = (req, _res, next) => {
    req.files = [
      {
        fieldname: "document",
        originalname: "invoice.pdf",
        mimetype: "application/pdf",
        size: 20345,
        buffer: Buffer.alloc(4),
      },
    ];
    next();
  };
  app.post("/upload", fakeMulter, (req, res) => res.json({ ok: true }));
  app.get("/health", (req, res) => res.json({ ok: true }));
  app.get("/with-queries", async (req, res) => {
    // Simulate what an ORM's query event would report during the request.
    trackQuery("SELECT * FROM users WHERE id = $1", 12);
    // Inline literals get scrubbed so no sensitive data is captured.
    trackQuery("SELECT * FROM sessions WHERE token = 'abc123'", 4);
    res.json({ ok: true });
  });
  app.get("/with-metadata", (req, res) => {
    setMetadata("user-id", "john");
    setMetadata({ plan: "premium", region: "eu" });
    res.json({ ok: true });
  });
  app.get("/large", (req, res) =>
    res.json({ blob: "a".repeat(4096), ok: true }),
  );
  app.get("/favicon.ico", (req, res) => res.send("icon"));
  app.get("/boom", () => {
    throw new Error("kaboom");
  });

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  captured = [];
});

test("captures a payload with the expected top-level structure", async () => {
  await realFetch(`${baseUrl}/health`);
  const [call] = await waitForCaptured();

  assert.equal(call.payload.sdk_token, "sdk_test_token");
  assert.equal(call.payload.api_key, "proj_test_key");
  assert.equal(call.payload.sdk, "express");
  assert.ok(call.payload.data.request);
  assert.ok(call.payload.data.response);
  assert.ok(call.payload.data.server);
  assert.equal(call.payload.data.language.name, "node");
});

test("sends the sdk token as the x-api-key header", async () => {
  await realFetch(`${baseUrl}/health`);
  const [call] = await waitForCaptured();
  assert.equal(call.headers["x-api-key"], "sdk_test_token");
});

test("masks sensitive fields in the request body", async () => {
  await realFetch(`${baseUrl}/users/42`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "secret", name: "bob" }),
  });
  const [call] = await waitForCaptured();

  assert.equal(call.payload.data.request.body.password, "******");
  assert.equal(call.payload.data.request.body.name, "bob");
});

test("replaces an uploaded file with a name/type/size descriptor", async () => {
  await realFetch(`${baseUrl}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "My upload" }),
  });
  const [call] = await waitForCaptured();

  assert.deepEqual(call.payload.data.request.body, {
    title: "My upload",
    document: { name: "invoice.pdf", type: "application/pdf", size: 20345 },
  });
});

test("masks the Authorization header", async () => {
  await realFetch(`${baseUrl}/health`, {
    headers: { Authorization: "Bearer super-secret-token" },
  });
  const [call] = await waitForCaptured();
  assert.equal(
    call.payload.data.request.headers.authorization,
    "*".repeat("Bearer super-secret-token".length),
  );
});

test("masks sensitive fields in the response body (incl. custom fields)", async () => {
  await realFetch(`${baseUrl}/users/7`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "alice" }),
  });
  const [call] = await waitForCaptured();

  assert.equal(call.payload.data.response.body.created, true);
  assert.equal(
    call.payload.data.response.body.password,
    "*".repeat("responseSecret".length),
  );
  assert.equal(call.payload.data.response.body.secretNote, "****");
});

test("records the route pattern in OpenAPI format", async () => {
  await realFetch(`${baseUrl}/users/999`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "x" }),
  });
  const [call] = await waitForCaptured();
  assert.equal(call.payload.data.request.route_path, "/users/{id}");
});

test("records request method and response status code", async () => {
  await realFetch(`${baseUrl}/health`);
  const [call] = await waitForCaptured();
  assert.equal(call.payload.data.request.method, "GET");
  assert.equal(call.payload.data.response.code, 200);
});

test("does NOT send a payload for default-blocked paths", async () => {
  await realFetch(`${baseUrl}/favicon.ico`);
  // Give the finish handler ample time; nothing should be captured.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(captured.length, 0);
});

test("captures the unhandled exception when a route throws", async () => {
  try {
    await realFetch(`${baseUrl}/boom`);
  } catch {
    // response body may vary; we only care that the SDK captured it
  }
  const [call] = await waitForCaptured();

  assert.equal(call.payload.data.response.code, 500);

  const unhandled = call.payload.data.errors.find(
    (e) => e.type === "UNHANDLED_EXCEPTION",
  );
  assert.ok(unhandled, "expected an UNHANDLED_EXCEPTION error entry");
  assert.equal(unhandled.message, "kaboom");
  assert.equal(unhandled.source, "onException");
});

test("gzips large outbound payloads (Content-Encoding: gzip)", async () => {
  await realFetch(`${baseUrl}/large`);
  const [call] = await waitForCaptured();
  // Large enough to cross the compression threshold.
  assert.equal(call.headers["Content-Encoding"], "gzip");
  assert.ok(Buffer.isBuffer(call.options.body));
  // The mock decompressed it, so the payload is still intact & correct.
  assert.equal(call.payload.data.response.body.ok, true);
});

test("does not gzip small outbound payloads", async () => {
  await realFetch(`${baseUrl}/health`);
  const [call] = await waitForCaptured();
  assert.equal(call.headers["Content-Encoding"], undefined);
  assert.equal(typeof call.options.body, "string");
});

test("includes tracked SQL queries in data.queries", async () => {
  await realFetch(`${baseUrl}/with-queries`);
  const [call] = await waitForCaptured();

  assert.deepEqual(call.payload.data.queries, [
    { sql: "SELECT * FROM users WHERE id = $1", time: 12 },
    { sql: "SELECT * FROM sessions WHERE token = ?", time: 4 },
  ]);
});

test("data.queries defaults to an empty array when none are tracked", async () => {
  await realFetch(`${baseUrl}/health`);
  const [call] = await waitForCaptured();
  assert.deepEqual(call.payload.data.queries, []);
});

test("includes custom metadata in data.metadata", async () => {
  await realFetch(`${baseUrl}/with-metadata`);
  const [call] = await waitForCaptured();

  assert.deepEqual(call.payload.data.metadata, {
    "user-id": "john",
    plan: "premium",
    region: "eu",
  });
});

test("data.metadata defaults to an empty object when none is set", async () => {
  await realFetch(`${baseUrl}/health`);
  const [call] = await waitForCaptured();
  assert.deepEqual(call.payload.data.metadata, {});
});

test("sends exactly one payload per request (no duplicate on error)", async () => {
  try {
    await realFetch(`${baseUrl}/boom`);
  } catch {
    // ignore
  }
  // Wait long enough that any duplicate send would have landed.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(captured.length, 1);
});
