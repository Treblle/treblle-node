const { test } = require("node:test");
const assert = require("node:assert/strict");

const zlib = require("node:zlib");
const {
  getPayloadSize,
  checkPayloadSize,
  getRandomEndpoint,
  resolveEndpoint,
  createStartTime,
  getRequestDuration,
  transformToOpenAPIFormat,
  getPayload,
  maybeGzipBody,
  GZIP_MIN_BYTES,
  TREBLLE_ENDPOINT,
  TREBLLE_ENDPOINTS,
  MAX_PAYLOAD_SIZE,
} = require("../src/sender");

test("getPayloadSize handles null/undefined", () => {
  assert.equal(getPayloadSize(null), 0);
  assert.equal(getPayloadSize(undefined), 0);
});

test("getPayloadSize measures string byte length (utf8)", () => {
  assert.equal(getPayloadSize("hello"), 5);
  // multi-byte character counts as its utf8 byte length
  assert.equal(getPayloadSize("€"), 3);
});

test("getPayloadSize measures buffer length", () => {
  assert.equal(getPayloadSize(Buffer.from("hello")), 5);
});

test("getPayloadSize estimates object size", () => {
  const size = getPayloadSize({ a: "hello", b: "world" });
  assert.ok(size > 0);
});

test("getPayloadSize handles circular references without throwing", () => {
  const obj = { a: "x" };
  obj.self = obj;
  assert.doesNotThrow(() => getPayloadSize(obj));
});

test("checkPayloadSize returns payload unchanged when under the limit", () => {
  const payload = { message: "small" };
  assert.equal(checkPayloadSize(payload), payload);
});

test("checkPayloadSize returns a too-large marker when over the limit", () => {
  const big = "x".repeat(MAX_PAYLOAD_SIZE + 1);
  const result = checkPayloadSize(big);
  assert.equal(typeof result, "object");
  assert.match(result.message, /5MB/);
  assert.ok(result.actual_size_bytes > MAX_PAYLOAD_SIZE);
});

test("getRandomEndpoint returns a known Treblle endpoint", () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(TREBLLE_ENDPOINTS.includes(getRandomEndpoint()));
  }
});

test("default endpoint is the ingress host", () => {
  assert.equal(TREBLLE_ENDPOINT, "https://ingress.treblle.com");
});

test("resolveEndpoint falls back to the default when no endpoint is given", () => {
  assert.equal(resolveEndpoint(), TREBLLE_ENDPOINT);
  assert.equal(resolveEndpoint(undefined), TREBLLE_ENDPOINT);
  assert.equal(resolveEndpoint(null), TREBLLE_ENDPOINT);
  assert.equal(resolveEndpoint(""), TREBLLE_ENDPOINT);
  assert.equal(resolveEndpoint("   "), TREBLLE_ENDPOINT);
});

test("resolveEndpoint uses a custom endpoint when provided", () => {
  assert.equal(
    resolveEndpoint("https://ingress-eu.treblle.com"),
    "https://ingress-eu.treblle.com"
  );
  // surrounding whitespace is trimmed
  assert.equal(
    resolveEndpoint("  https://ingress-eu.treblle.com  "),
    "https://ingress-eu.treblle.com"
  );
});

test("createStartTime returns a usable start marker", () => {
  const t = createStartTime();
  assert.ok(typeof t === "number" || Array.isArray(t));
});

test("getRequestDuration returns a non-negative number for a numeric start", () => {
  const start = createStartTime();
  const duration = getRequestDuration(start);
  assert.equal(typeof duration, "number");
  assert.ok(duration >= 0);
});

test("getRequestDuration handles hrtime array format", () => {
  const start = process.hrtime();
  const duration = getRequestDuration(start);
  assert.equal(typeof duration, "number");
  assert.ok(duration >= 0);
});

test("getRequestDuration returns 0 for unrecognized input", () => {
  assert.equal(getRequestDuration("not-a-time"), 0);
  assert.equal(getRequestDuration(null), 0);
});

test("transformToOpenAPIFormat converts :param to {param}", () => {
  assert.equal(transformToOpenAPIFormat("/users/:id"), "/users/{id}");
  assert.equal(
    transformToOpenAPIFormat("/users/:userId/posts/:postId"),
    "/users/{userId}/posts/{postId}"
  );
});

test("transformToOpenAPIFormat converts optional :param? to {param}", () => {
  assert.equal(transformToOpenAPIFormat("/users/:id?"), "/users/{id}");
});

test("transformToOpenAPIFormat leaves static paths unchanged", () => {
  assert.equal(transformToOpenAPIFormat("/users/list"), "/users/list");
});

test("getPayload returns objects as-is", () => {
  const obj = { a: 1 };
  assert.equal(getPayload(obj), obj);
});

test("getPayload parses JSON strings", () => {
  assert.deepEqual(getPayload('{"a":1}'), { a: 1 });
});

test("getPayload returns null for unparseable strings", () => {
  assert.equal(getPayload("not json"), null);
});

test("maybeGzipBody leaves small payloads uncompressed", async () => {
  const small = JSON.stringify({ hello: "world" });
  const { body, encoding } = await maybeGzipBody(small);
  assert.equal(body, small);
  assert.equal(encoding, null);
});

test("maybeGzipBody gzips payloads at or above the threshold", async () => {
  const big = JSON.stringify({ blob: "a".repeat(GZIP_MIN_BYTES * 2) });
  const { body, encoding } = await maybeGzipBody(big);
  assert.equal(encoding, "gzip");
  assert.ok(Buffer.isBuffer(body));
  // Round-trips back to the original JSON, and is smaller than the input.
  assert.equal(zlib.gunzipSync(body).toString("utf8"), big);
  assert.ok(body.length < Buffer.byteLength(big));
});
