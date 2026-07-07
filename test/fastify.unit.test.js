// Unit tests for the Fastify adapter, driving the real hooks with a fake
// Fastify instance and an intercepted fetch.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const {
  useFastifyTreblle,
  useNestFastifyTreblle,
} = require("../src/adapters/fastify");
const { trackQuery } = require("../src/queryTracking");

function interceptFetch() {
  const original = globalThis.fetch;
  let resolvePayload;
  const captured = new Promise((resolve) => {
    resolvePayload = resolve;
  });
  globalThis.fetch = async (url, options) => {
    let body = options.body;
    if (options.headers["Content-Encoding"] === "gzip") {
      body = zlib.gunzipSync(body).toString("utf8");
    }
    resolvePayload(JSON.parse(body));
    return { ok: true, status: 200, statusText: "OK" };
  };
  return {
    captured,
    restore() {
      globalThis.fetch = original;
    },
  };
}

// Minimal stand-in for a Fastify instance: records hooks so the harness can
// replay them in lifecycle order.
function fakeFastify() {
  const hooks = {};
  return {
    hooks,
    addHook(name, fn) {
      (hooks[name] = hooks[name] || []).push(fn);
    },
  };
}

function fakeRequest({
  url = "/items?x=1",
  method = "GET",
  body = { name: "Ada", password: "hunter2" },
} = {}) {
  return {
    method,
    url,
    query: { x: "1" },
    body: method === "GET" ? undefined : body,
    protocol: "http",
    hostname: "localhost:3000",
    ip: "::1",
    headers: { host: "localhost:3000", "user-agent": "fastify-unit" },
    raw: { httpVersion: "1.1" },
    routeOptions: { url: "/items" },
  };
}

function fakeReply({ body = { ok: true }, statusCode = 200 } = {}) {
  const serialized = JSON.stringify(body);
  return {
    statusCode,
    _headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(serialized),
    },
    getHeader(name) {
      return this._headers[name.toLowerCase()];
    },
    getHeaders() {
      return this._headers;
    },
    _serialized: serialized,
  };
}

// Runs a request through the registered hooks in Fastify's lifecycle order.
// `onHandler` runs between onRequest and onSend to simulate route work (e.g.
// trackQuery calls). If it throws, the onError hook fires like Fastify's.
async function runRequest(app, request, reply, onHandler) {
  const run = (fn, ...args) =>
    new Promise((resolve, reject) => {
      const done = (err, val) => (err ? reject(err) : resolve(val));
      Promise.resolve(fn(...args, done)).catch(reject);
    });

  for (const hook of app.hooks.onRequest || []) {
    await run(hook, request, reply);
  }
  try {
    if (onHandler) await onHandler();
  } catch (error) {
    request._threwFromHandler = error;
    for (const hook of app.hooks.onError || []) {
      await run(hook, request, reply, error);
    }
  }
  for (const hook of app.hooks.onSend || []) {
    await run(hook, request, reply, reply._serialized);
  }
  for (const hook of app.hooks.onResponse || []) {
    await run(hook, request, reply);
  }
}

test("useFastifyTreblle sends a payload with request/response data", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const app = fakeFastify();
    useFastifyTreblle(app, { sdkToken: "t", apiKey: "k" });

    await runRequest(app, fakeRequest(), fakeReply());
    const envelope = await captured;

    assert.equal(envelope.sdk, "fastify");
    assert.equal(envelope.version, 20);
    assert.equal(envelope.data.request.method, "GET");
    assert.equal(envelope.data.request.url, "http://localhost:3000/items?x=1");
    assert.equal(envelope.data.request.route_path, "/items");
    assert.equal(envelope.data.response.code, 200);
    assert.deepEqual(envelope.data.request.body, { x: "1" });
    assert.deepEqual(envelope.data.response.body, { ok: true });
  } finally {
    restore();
  }
});

test("useFastifyTreblle replaces attachFieldsToBody uploads with descriptors", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const app = fakeFastify();
    useFastifyTreblle(app, { sdkToken: "t", apiKey: "k" });

    // @fastify/multipart with attachFieldsToBody: true puts file fields inline
    // on request.body as { type: "file", filename, mimetype, _buf }.
    const request = fakeRequest({
      method: "POST",
      body: {
        title: "My upload",
        document: {
          type: "file",
          fieldname: "document",
          filename: "invoice.pdf",
          mimetype: "application/pdf",
          _buf: Buffer.alloc(20345),
        },
      },
    });

    await runRequest(app, request, fakeReply());
    const envelope = await captured;

    assert.deepEqual(envelope.data.request.body, {
      title: "My upload",
      document: { name: "invoice.pdf", type: "application/pdf", size: 20345 },
    });
  } finally {
    restore();
  }
});

test("useFastifyTreblle masks default keywords when the option is omitted", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const app = fakeFastify();
    useFastifyTreblle(app, { sdkToken: "t", apiKey: "k" });

    await runRequest(
      app,
      fakeRequest({ method: "POST" }),
      fakeReply({ body: { token: "secret-token" } }),
    );
    const envelope = await captured;

    assert.equal(envelope.data.request.body.password, "*******");
    assert.equal(envelope.data.response.body.token, "************");
  } finally {
    restore();
  }
});

test("useFastifyTreblle records tracked queries from the handler", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const app = fakeFastify();
    useFastifyTreblle(app, { sdkToken: "t", apiKey: "k" });

    await runRequest(app, fakeRequest(), fakeReply(), async () => {
      // Simulates a query made inside the route handler, under the ALS context
      // opened by the onRequest hook.
      trackQuery("SELECT * FROM items WHERE id = 1", 4);
    });
    const envelope = await captured;

    assert.equal(envelope.data.queries.length, 1);
    assert.equal(
      envelope.data.queries[0].sql,
      "SELECT * FROM items WHERE id = ?",
    );
  } finally {
    restore();
  }
});

test("useFastifyTreblle records a thrown error and reports it", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const app = fakeFastify();
    useFastifyTreblle(app, { sdkToken: "t", apiKey: "k" });

    await runRequest(
      app,
      fakeRequest(),
      fakeReply({ statusCode: 500 }),
      async () => {
        throw new Error("fastify-boom");
      },
    );
    const envelope = await captured;

    assert.equal(envelope.data.errors.length, 1);
    assert.equal(envelope.data.errors[0].type, "UNHANDLED_EXCEPTION");
    assert.equal(envelope.data.errors[0].message, "fastify-boom");
  } finally {
    restore();
  }
});

test("useFastifyTreblle skips blocked paths without sending", async () => {
  const original = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return { ok: true, status: 200, statusText: "OK" };
  };
  try {
    const app = fakeFastify();
    useFastifyTreblle(app, { sdkToken: "t", apiKey: "k" });

    await runRequest(app, fakeRequest({ url: "/favicon.ico" }), fakeReply());
    await new Promise((r) => setImmediate(r));

    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("useNestFastifyTreblle reports sdk nest", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const app = fakeFastify();
    useNestFastifyTreblle(app, { sdkToken: "t", apiKey: "k" });

    await runRequest(app, fakeRequest(), fakeReply());
    const envelope = await captured;

    assert.equal(envelope.sdk, "nest");
  } finally {
    restore();
  }
});
