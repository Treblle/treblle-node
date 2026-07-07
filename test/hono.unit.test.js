// Unit tests for the Hono adapter, driving the real middleware with a fake
// Hono context and an intercepted fetch.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const { honoTreblle } = require("../src/adapters/hono");

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

function fakeHonoCtx({
  url = "http://localhost:5000/login",
  method = "POST",
  requestBody = JSON.stringify({ email: "a@b.com", password: "hunter2" }),
  responseBody = JSON.stringify({ ok: true }),
} = {}) {
  const reqHeaders = {
    "user-agent": "hono-unit",
    "content-type": "application/json",
    "x-real-ip": "10.1.2.3",
  };
  return {
    req: {
      method,
      url,
      queries() {
        return { q: ["1"] };
      },
      header(name) {
        return reqHeaders[name.toLowerCase()];
      },
      async json() {
        return JSON.parse(requestBody);
      },
      async text() {
        return requestBody;
      },
      async parseBody() {
        return {};
      },
      raw: { headers: new Headers(reqHeaders) },
      routePath: "/login",
    },
    res: new Response(responseBody, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  };
}

test("honoTreblle sends a payload after next() resolves", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const middleware = honoTreblle({ sdkToken: "t", apiKey: "k" });
    await middleware(fakeHonoCtx(), async () => {});
    const envelope = await captured;

    assert.equal(envelope.sdk, "hono");
    assert.equal(envelope.version, 30);
    assert.equal(envelope.data.request.method, "POST");
    assert.equal(envelope.data.request.ip, "10.1.2.3");
    assert.equal(envelope.data.request.route_path, "/login");
    // default masking must be ON when maskedKeywords is omitted
    assert.equal(envelope.data.request.body.password, "*******");
    assert.deepEqual(envelope.data.response.body, { ok: true });
  } finally {
    restore();
  }
});

test("honoTreblle replaces uploaded files with name/type/size descriptors", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const ctx = fakeHonoCtx({ method: "POST" });
    // A multipart request: parseBody() returns text fields plus inline Files.
    const headers = {
      "user-agent": "hono-unit",
      "content-type": "multipart/form-data; boundary=x",
      "x-real-ip": "10.1.2.3",
    };
    ctx.req.header = (name) => headers[name.toLowerCase()];
    ctx.req.parseBody = async () => ({
      title: "My upload",
      document: new File([new Uint8Array(20345)], "invoice.pdf", {
        type: "application/pdf",
      }),
    });

    const middleware = honoTreblle({ sdkToken: "t", apiKey: "k" });
    await middleware(ctx, async () => {});
    const envelope = await captured;

    assert.deepEqual(envelope.data.request.body, {
      title: "My upload",
      document: { name: "invoice.pdf", type: "application/pdf", size: 20345 },
    });
  } finally {
    restore();
  }
});

test("honoTreblle sends the payload and rethrows when next() throws", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const middleware = honoTreblle({ sdkToken: "t", apiKey: "k" });
    await assert.rejects(
      middleware(fakeHonoCtx(), async () => {
        throw new Error("hono-boom");
      }),
      /hono-boom/,
    );
    const envelope = await captured;

    assert.equal(
      envelope.data.errors.some(
        (e) => e.type === "UNHANDLED_EXCEPTION" && e.message === "hono-boom",
      ),
      true,
    );
  } finally {
    restore();
  }
});

test("honoTreblle skips blocked paths", async () => {
  const original = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return { ok: true, status: 200, statusText: "OK" };
  };
  try {
    const middleware = honoTreblle({ sdkToken: "t", apiKey: "k" });
    let nextCalled = false;
    await middleware(
      fakeHonoCtx({ url: "http://localhost:5000/static/app.css" }),
      async () => {
        nextCalled = true;
      },
    );
    await new Promise((r) => setImmediate(r));

    assert.equal(nextCalled, true);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("honoTreblle uses executionCtx.waitUntil when present", async () => {
  const { captured, restore } = interceptFetch();
  try {
    let waitUntilCalled = 0;
    const c = fakeHonoCtx();
    c.executionCtx = {
      waitUntil(promise) {
        waitUntilCalled++;
        promise.catch(() => {});
      },
    };
    const middleware = honoTreblle({ sdkToken: "t", apiKey: "k" });
    await middleware(c, async () => {});
    await captured;

    assert.equal(waitUntilCalled, 1);
  } finally {
    restore();
  }
});
