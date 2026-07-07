// Unit tests for the Koa/Strapi adapter, driving the real middleware with a
// fake Koa context and an intercepted fetch.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const { koaTreblle, strapiTreblle } = require("../src/adapters/koa");

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

function fakeKoaCtx({
  url = "/items?x=1",
  method = "GET",
  body = { ok: true },
} = {}) {
  return {
    request: {
      method,
      query: { x: "1" },
      body: method === "GET" ? undefined : { name: "Ada", password: "hunter2" },
      protocol: "http",
      req: { httpVersion: "1.1" },
      ip: "::1",
      url,
      header: { "user-agent": "koa-unit" },
      headers: { host: "localhost:4000", "user-agent": "koa-unit" },
      originalUrl: url,
      get(name) {
        return this.headers[name.toLowerCase()];
      },
    },
    response: {
      headers: { "content-type": "application/json" },
      status: 200,
      length: 15,
      body,
    },
    _matchedRoute: "/items",
  };
}

test("koaTreblle sends a payload after next() resolves", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const middleware = koaTreblle({ sdkToken: "t", apiKey: "k" });
    await middleware(fakeKoaCtx(), async () => {});
    const envelope = await captured;

    assert.equal(envelope.sdk, "koa");
    assert.equal(envelope.version, 30);
    assert.equal(envelope.data.request.method, "GET");
    assert.equal(envelope.data.response.code, 200);
    assert.deepEqual(envelope.data.request.body, { x: "1" });
  } finally {
    restore();
  }
});

test("koaTreblle replaces uploaded files with name/type/size descriptors", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const ctx = fakeKoaCtx({ method: "POST" });
    // koa-body/formidable expose parsed files on ctx.request.files. The fake
    // ctx's request body is the hardcoded { name, password }.
    ctx.request.files = {
      document: {
        originalFilename: "invoice.pdf",
        mimetype: "application/pdf",
        size: 20345,
        filepath: "/tmp/invoice.pdf",
      },
    };
    const middleware = koaTreblle({ sdkToken: "t", apiKey: "k" });
    await middleware(ctx, async () => {});
    const envelope = await captured;

    // password stays masked; the file becomes a descriptor field.
    assert.equal(envelope.data.request.body.name, "Ada");
    assert.deepEqual(envelope.data.request.body.document, {
      name: "invoice.pdf",
      type: "application/pdf",
      size: 20345,
    });
  } finally {
    restore();
  }
});

test("koaTreblle masks default keywords when the option is omitted", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const middleware = koaTreblle({ sdkToken: "t", apiKey: "k" });
    await middleware(
      fakeKoaCtx({ method: "POST", body: { token: "secret-token" } }),
      async () => {},
    );
    const envelope = await captured;

    // default masking must be ON when maskedKeywords is omitted
    assert.equal(envelope.data.request.body.password, "*******");
    assert.equal(envelope.data.response.body.token, "************");
  } finally {
    restore();
  }
});

test("koaTreblle sends the payload and rethrows when next() throws", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const middleware = koaTreblle({ sdkToken: "t", apiKey: "k" });
    await assert.rejects(
      middleware(fakeKoaCtx(), async () => {
        throw new Error("koa-boom");
      }),
      /koa-boom/,
    );
    const envelope = await captured;

    assert.equal(envelope.data.errors.length, 1);
    assert.equal(envelope.data.errors[0].type, "UNHANDLED_EXCEPTION");
    assert.equal(envelope.data.errors[0].message, "koa-boom");
  } finally {
    restore();
  }
});

test("koaTreblle skips blocked paths", async () => {
  const original = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return { ok: true, status: 200, statusText: "OK" };
  };
  try {
    const middleware = koaTreblle({ sdkToken: "t", apiKey: "k" });
    let nextCalled = false;
    await middleware(fakeKoaCtx({ url: "/favicon.ico" }), async () => {
      nextCalled = true;
    });
    // give any stray fire-and-forget send a tick to land
    await new Promise((r) => setImmediate(r));

    assert.equal(nextCalled, true);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("strapiTreblle skips admin routes and reports sdk strapi otherwise", async () => {
  const { captured, restore } = interceptFetch();
  try {
    const middleware = strapiTreblle({ sdkToken: "t", apiKey: "k" });

    let nextCalled = false;
    await middleware(fakeKoaCtx({ url: "/admin/settings" }), async () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);

    await middleware(fakeKoaCtx(), async () => {});
    const envelope = await captured;
    assert.equal(envelope.sdk, "strapi");
  } finally {
    restore();
  }
});
