// Characterization test for the Treblle wire envelope.
//
// Locks the exact payload each framework send-path produces so the
// core/adapter refactor can prove it did not change the wire format. Drives
// the send paths with hand-built fake framework objects, intercepts the
// outbound fetch, and deep-equals the entire envelope.
const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const zlib = require("node:zlib");

const { normalizeConfig } = require("../src/core/config");
const { captureAndSend, captureAndSendAsync } = require("../src/core/capture");
const { buildExpressSnapshot } = require("../src/adapters/express");
const { buildKoaSnapshot } = require("../src/adapters/koa");
const { buildHonoSnapshot } = require("../src/adapters/hono");

const SERVER_BLOCK = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  os: {
    name: os.platform(),
    release: os.release(),
    architecture: os.arch(),
  },
  software: null,
  signature: null,
};

const LANGUAGE_BLOCK = { name: "node", version: process.version };

// Intercepts the next outbound fetch and resolves with its parsed envelope.
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
    resolvePayload({
      url,
      headers: options.headers,
      envelope: JSON.parse(body),
    });
    return { ok: true, status: 200, statusText: "OK" };
  };
  return {
    captured,
    restore() {
      globalThis.fetch = original;
    },
  };
}

// Replaces the volatile fields (clock/timing dependent) with stable markers
// after asserting they have the right shape.
function normalizeEnvelope(envelope) {
  assert.match(
    envelope.data.request.timestamp,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
  );
  assert.strictEqual(typeof envelope.data.response.load_time, "number");
  envelope.data.request.timestamp = "<timestamp>";
  envelope.data.response.load_time = "<load_time>";
  for (const error of envelope.data.errors) {
    if (error.type === "UNHANDLED_EXCEPTION") {
      assert.strictEqual(typeof error.file, "string");
      assert.strictEqual(typeof error.line, "number");
      error.file = "<file>";
      error.line = "<line>";
    }
  }
  return envelope;
}

function configFor(sdk) {
  return normalizeConfig(
    { sdkToken: "test-sdk-token", apiKey: "test-api-key" },
    { sdk },
  );
}

function fakeExpressReq() {
  return {
    method: "POST",
    body: { name: "Ada", password: "secret123" },
    query: {},
    protocol: "http",
    httpVersion: "1.1",
    ip: "127.0.0.1",
    originalUrl: "/users/42?verbose=1",
    headers: {
      host: "localhost:3000",
      "user-agent": "parity-test",
      authorization: "Bearer abc",
    },
    route: { path: "/users/:id" },
    get(name) {
      return this.headers[name.toLowerCase()];
    },
  };
}

function fakeExpressRes() {
  return {
    statusCode: 201,
    _contentLength: 27,
    __treblle_body_response: JSON.stringify({ id: 42, token: "tok_123" }),
    getHeaders() {
      return { "content-type": "application/json" };
    },
  };
}

test("express payload envelope is stable", async () => {
  const { captured, restore } = interceptFetch();
  try {
    captureAndSend(
      configFor("express"),
      buildExpressSnapshot(fakeExpressReq(), fakeExpressRes(), {
        requestStartTime: process.hrtime(),
        queries: [{ sql: "SELECT * FROM users WHERE id = ?", time: 3 }],
      }),
    );
    const { envelope, headers } = await captured;

    assert.strictEqual(headers["x-api-key"], "test-sdk-token");
    assert.deepStrictEqual(normalizeEnvelope(envelope), {
      sdk_token: "test-sdk-token",
      api_key: "test-api-key",
      version: 20,
      sdk: "express",
      data: {
        server: { ...SERVER_BLOCK, protocol: "HTTP/1.1" },
        language: LANGUAGE_BLOCK,
        request: {
          timestamp: "<timestamp>",
          ip: "127.0.0.1",
          url: "http://localhost:3000/users/42?verbose=1",
          user_agent: "parity-test",
          method: "POST",
          headers: {
            host: "localhost:3000",
            "user-agent": "parity-test",
            authorization: "**********",
          },
          body: { name: "Ada", password: "*********" },
          route_path: "/users/{id}",
        },
        response: {
          headers: { "content-type": "application/json" },
          code: 201,
          size: 27,
          load_time: "<load_time>",
          body: { id: 42, token: "*******" },
        },
        errors: [],
        queries: [{ sql: "SELECT * FROM users WHERE id = ?", time: 3 }],
        metadata: {},
      },
    });
  } finally {
    restore();
  }
});

test("express payload records unhandled exceptions", async () => {
  const { captured, restore } = interceptFetch();
  try {
    captureAndSend(
      configFor("express"),
      buildExpressSnapshot(fakeExpressReq(), fakeExpressRes(), {
        requestStartTime: process.hrtime(),
        error: new Error("boom"),
      }),
    );
    const { envelope } = await captured;
    normalizeEnvelope(envelope);

    assert.deepStrictEqual(envelope.data.errors, [
      {
        source: "onException",
        type: "UNHANDLED_EXCEPTION",
        message: "boom",
        file: "<file>",
        line: "<line>",
      },
    ]);
  } finally {
    restore();
  }
});

test("koa payload envelope is stable", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const ctx = {
      request: {
        method: "GET",
        query: { search: "hello" },
        body: undefined,
        protocol: "http",
        req: { httpVersion: "1.1" },
        ip: "::1",
        header: { "user-agent": "parity-test-koa" },
        headers: { host: "localhost:4000", "user-agent": "parity-test-koa" },
        originalUrl: "/items?search=hello",
        get(name) {
          return this.headers[name.toLowerCase()];
        },
      },
      response: {
        headers: { "content-type": "application/json" },
        status: 200,
        length: 15,
        body: { items: [], api_key: "k-123" },
      },
      _matchedRoute: "/items",
    };

    captureAndSend(
      configFor("koa"),
      buildKoaSnapshot(ctx, { requestStartTime: process.hrtime() }),
    );
    const { envelope } = await captured;

    assert.deepStrictEqual(normalizeEnvelope(envelope), {
      sdk_token: "test-sdk-token",
      api_key: "test-api-key",
      version: 20,
      sdk: "koa",
      data: {
        server: { ...SERVER_BLOCK, protocol: "HTTP/1.1" },
        language: LANGUAGE_BLOCK,
        request: {
          timestamp: "<timestamp>",
          ip: "::1",
          url: "http://localhost:4000/items?search=hello",
          user_agent: "parity-test-koa",
          method: "GET",
          headers: { host: "localhost:4000", "user-agent": "parity-test-koa" },
          body: { search: "hello" },
          route_path: "/items",
        },
        response: {
          headers: { "content-type": "application/json" },
          code: 200,
          size: 15,
          load_time: "<load_time>",
          body: { items: [], api_key: "*****" },
        },
        errors: [],
        queries: [],
        metadata: {},
      },
    });
  } finally {
    restore();
  }
});

test("hono payload envelope is stable", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const honoHeaders = {
      "user-agent": "parity-test-hono",
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.1, 172.16.0.1",
    };
    const c = {
      req: {
        method: "POST",
        url: "http://localhost:5000/login",
        queries() {
          return {};
        },
        header(name) {
          return honoHeaders[name.toLowerCase()];
        },
        raw: { headers: new Headers(honoHeaders) },
        routePath: "/login",
      },
      res: {
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
      },
      __treblle_body_request: { email: "ada@example.com", password: "hunter2" },
      __treblle_body_response: JSON.stringify({ ok: true }),
      __treblle_body_response_size: 11,
    };

    await captureAndSendAsync(
      configFor("hono"),
      buildHonoSnapshot(c, { requestStartTime: performance.now() }),
    );
    const { envelope } = await captured;

    assert.deepStrictEqual(normalizeEnvelope(envelope), {
      sdk_token: "test-sdk-token",
      api_key: "test-api-key",
      version: 20,
      sdk: "hono",
      data: {
        server: { ...SERVER_BLOCK, protocol: "HTTP/1.1" },
        language: LANGUAGE_BLOCK,
        request: {
          timestamp: "<timestamp>",
          ip: "10.0.0.1",
          url: "http://localhost:5000/login",
          user_agent: "parity-test-hono",
          method: "POST",
          headers: {
            "user-agent": "parity-test-hono",
            "content-type": "application/json",
            "x-forwarded-for": "10.0.0.1, 172.16.0.1",
          },
          body: { email: "ada@example.com", password: "*******" },
          route_path: "/login",
        },
        response: {
          headers: { "content-type": "application/json" },
          code: 200,
          size: 11,
          load_time: "<load_time>",
          body: { ok: true },
        },
        errors: [],
        queries: [],
        metadata: {},
      },
    });
  } finally {
    restore();
  }
});

test("all adapters produce envelopes with identical key sets", () => {
  const { buildPayload } = require("../src/core/payload");

  const expressEnvelope = buildPayload(
    configFor("express"),
    buildExpressSnapshot(fakeExpressReq(), fakeExpressRes(), {
      requestStartTime: process.hrtime(),
    }),
  );
  const koaEnvelope = buildPayload(
    configFor("koa"),
    buildKoaSnapshot(
      {
        request: {
          method: "GET",
          query: {},
          protocol: "http",
          req: { httpVersion: "1.1" },
          ip: "::1",
          header: {},
          headers: { host: "h" },
          originalUrl: "/",
          get() {
            return "h";
          },
        },
        response: { headers: {}, status: 200, length: 2, body: {} },
        _matchedRoute: "/",
      },
      { requestStartTime: process.hrtime() },
    ),
  );
  const honoEnvelope = buildPayload(
    configFor("hono"),
    buildHonoSnapshot(
      {
        req: {
          method: "GET",
          url: "http://h/",
          queries: () => ({}),
          header: () => undefined,
          raw: { headers: new Headers() },
          routePath: "/",
        },
        res: { status: 200, headers: new Headers() },
        __treblle_body_response: "{}",
        __treblle_body_response_size: 2,
      },
      { requestStartTime: performance.now() },
    ),
  );

  const keysOf = (envelope) => ({
    top: Object.keys(envelope).sort(),
    data: Object.keys(envelope.data).sort(),
    request: Object.keys(envelope.data.request).sort(),
    response: Object.keys(envelope.data.response).sort(),
  });

  assert.deepStrictEqual(keysOf(koaEnvelope), keysOf(expressEnvelope));
  assert.deepStrictEqual(keysOf(honoEnvelope), keysOf(expressEnvelope));
});

test("buildPayload collapses a raw Buffer request body to a descriptor", () => {
  const { buildPayload } = require("../src/core/payload");

  const envelope = buildPayload(configFor("express"), {
    protocol: "HTTP/1.1",
    request: {
      ip: "::1",
      url: "http://localhost/upload",
      userAgent: "raw-test",
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: Buffer.alloc(4096),
      routePath: "/upload",
    },
    response: { statusCode: 200, headers: {}, body: {}, size: 2 },
    startTime: process.hrtime(),
  });

  assert.deepStrictEqual(envelope.data.request.body, {
    name: null,
    type: "application/pdf",
    size: 4096,
  });
});

test("buildPayload surfaces snapshot metadata as data.metadata", () => {
  const { buildPayload } = require("../src/core/payload");

  const withMetadata = buildPayload(
    configFor("express"),
    buildExpressSnapshot(fakeExpressReq(), fakeExpressRes(), {
      requestStartTime: process.hrtime(),
      metadata: { "user-id": "john", plan: "premium" },
    }),
  );
  assert.deepStrictEqual(withMetadata.data.metadata, {
    "user-id": "john",
    plan: "premium",
  });

  const withoutMetadata = buildPayload(
    configFor("express"),
    buildExpressSnapshot(fakeExpressReq(), fakeExpressRes(), {
      requestStartTime: process.hrtime(),
    }),
  );
  assert.deepStrictEqual(withoutMetadata.data.metadata, {});
});

test("no data is sent when credentials are missing", async () => {
  const original = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200, statusText: "OK" };
  };
  try {
    // No sdkToken/apiKey — the SDK must not even attempt a send.
    const config = normalizeConfig({}, { sdk: "express" });
    assert.equal(config.enabled, false);
    captureAndSend(
      config,
      buildExpressSnapshot(fakeExpressReq(), fakeExpressRes(), {
        requestStartTime: process.hrtime(),
      }),
    );
    // Give any (erroneous) async send a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("non-JSON response bodies are replaced with a marker, not an error", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const res = fakeExpressRes();
    res.__treblle_body_response = "<html>not json</html>";
    captureAndSend(
      configFor("express"),
      buildExpressSnapshot(fakeExpressReq(), res, {
        requestStartTime: process.hrtime(),
      }),
    );
    const { envelope } = await captured;
    normalizeEnvelope(envelope);

    // Treblle only stores JSON bodies; a non-JSON response is gracefully swapped
    // for a marker object and no error is recorded.
    assert.deepStrictEqual(envelope.data.response.body, {
      message: "Invalid JSON returned in response body",
    });
    assert.deepStrictEqual(envelope.data.errors, []);
  } finally {
    restore();
  }
});
