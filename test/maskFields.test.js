const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_MASKED_KEYWORDS,
  generateFieldsToMaskMap,
  maskSensitiveValues,
} = require("../src/maskFields");

test("generateFieldsToMaskMap includes default sensitive fields", () => {
  const map = generateFieldsToMaskMap();
  assert.equal(map.password, true);
  assert.equal(map.ssn, true);
  assert.equal(map.cc, true);
});

test("generateFieldsToMaskMap includes auth/session credentials by default", () => {
  const map = generateFieldsToMaskMap();
  // These must be masked to avoid leaking credentials to Treblle.
  assert.equal(map.authorization, true);
  assert.equal(map.cookie, true);
  assert.equal(map["set-cookie"], true);
  assert.equal(map["x-api-key"], true);
  assert.equal(map.token, true);
  assert.equal(map.access_token, true);
  assert.equal(map.refresh_token, true);
  assert.equal(map.bearer, true);
});

test("generateFieldsToMaskMap lower-cases all keys (case-insensitive matching)", () => {
  const map = generateFieldsToMaskMap(["MyCustomSecret", "X-Session-ID"]);
  assert.equal(map.mycustomsecret, true);
  assert.equal(map["x-session-id"], true);
});

test("generateFieldsToMaskMap treats the passed array as the authoritative list", () => {
  // Providing your own keywords replaces the defaults, it does not merge.
  const map = generateFieldsToMaskMap(["custom_field"]);
  assert.equal(map.custom_field, true);
  assert.equal(map.password, undefined);
});

test("generateFieldsToMaskMap can extend the defaults by spreading them", () => {
  const map = generateFieldsToMaskMap([...DEFAULT_MASKED_KEYWORDS, "custom_field"]);
  assert.equal(map.custom_field, true);
  assert.equal(map.password, true);
});

test("generateFieldsToMaskMap returns null when given an empty array (masking off)", () => {
  assert.equal(generateFieldsToMaskMap([]), null);
});

test("maskSensitiveValues returns the payload untouched when masking is off", () => {
  const input = { password: "hunter2", authorization: "Bearer abc" };
  const result = maskSensitiveValues(input, null);
  // Same reference, nothing masked.
  assert.equal(result, input);
  assert.equal(result.password, "hunter2");
  assert.equal(result.authorization, "Bearer abc");
});

test("maskSensitiveValues masks string values of sensitive keys", () => {
  const map = generateFieldsToMaskMap();
  const result = maskSensitiveValues({ password: "hunter2" }, map);
  assert.equal(result.password, "*******");
});

test("maskSensitiveValues masking preserves the original length", () => {
  const map = generateFieldsToMaskMap();
  const result = maskSensitiveValues({ password: "abcd" }, map);
  assert.equal(result.password, "****");
});

test("maskSensitiveValues is case-insensitive on keys", () => {
  const map = generateFieldsToMaskMap();
  const result = maskSensitiveValues(
    { Password: "secret", AUTHORIZATION: "Bearer x" },
    map
  );
  assert.equal(result.Password, "******");
  assert.equal(result.AUTHORIZATION, "********");
});

test("maskSensitiveValues masks non-string primitive values", () => {
  const map = generateFieldsToMaskMap();
  const result = maskSensitiveValues({ ssn: 123456789, cc: 4111 }, map);
  // 123456789 -> 9 chars, 4111 -> 4 chars
  assert.equal(result.ssn, "*********");
  assert.equal(result.cc, "****");
});

test("maskSensitiveValues masks nested objects under a sensitive key", () => {
  const map = generateFieldsToMaskMap(["credentials"]);
  const result = maskSensitiveValues(
    { credentials: { user: "bob", pass: "12345" } },
    map
  );
  assert.equal(result.credentials.user, "***");
  assert.equal(result.credentials.pass, "*****");
});

test("maskSensitiveValues recurses into nested non-sensitive objects", () => {
  const map = generateFieldsToMaskMap();
  const result = maskSensitiveValues(
    { user: { name: "bob", password: "topsecret" } },
    map
  );
  assert.equal(result.user.name, "bob");
  assert.equal(result.user.password, "*********");
});

test("maskSensitiveValues handles arrays of objects", () => {
  const map = generateFieldsToMaskMap();
  const result = maskSensitiveValues(
    { users: [{ password: "aa" }, { password: "bbb" }] },
    map
  );
  assert.equal(result.users[0].password, "**");
  assert.equal(result.users[1].password, "***");
});

test("maskSensitiveValues leaves non-sensitive fields untouched", () => {
  const map = generateFieldsToMaskMap();
  const input = { name: "Alice", age: 30, active: true, meta: null };
  const result = maskSensitiveValues(input, map);
  assert.deepEqual(result, input);
});

test("maskSensitiveValues returns null/undefined unchanged", () => {
  const map = generateFieldsToMaskMap();
  assert.equal(maskSensitiveValues(null, map), null);
  assert.equal(maskSensitiveValues(undefined, map), undefined);
});

test("maskSensitiveValues returns primitives unchanged", () => {
  const map = generateFieldsToMaskMap();
  assert.equal(maskSensitiveValues("hello", map), "hello");
  assert.equal(maskSensitiveValues(42, map), 42);
});

test("maskSensitiveValues does not treat null-valued sensitive fields as objects", () => {
  const map = generateFieldsToMaskMap();
  const result = maskSensitiveValues({ password: null }, map);
  assert.equal(result.password, null);
});

test("maskSensitiveValues masks a realistic headers object", () => {
  const map = generateFieldsToMaskMap();
  const headers = {
    "content-type": "application/json",
    authorization: "Bearer abc.def.ghi",
    cookie: "session=xyz",
    "user-agent": "test",
  };
  const result = maskSensitiveValues(headers, map);
  assert.equal(result["content-type"], "application/json");
  assert.equal(result["user-agent"], "test");
  assert.equal(result.authorization, "*".repeat("Bearer abc.def.ghi".length));
  assert.equal(result.cookie, "*".repeat("session=xyz".length));
});

test("maskSensitiveValues does not mutate the input object", () => {
  const map = generateFieldsToMaskMap();
  const input = { password: "secret", nested: { token: "abc" } };
  maskSensitiveValues(input, map);
  assert.equal(input.password, "secret");
  assert.equal(input.nested.token, "abc");
});

test("maskSensitiveValues returns the same reference when nothing is masked (copy-on-write)", () => {
  const map = generateFieldsToMaskMap();
  const input = { name: "Alice", nested: { city: "NYC" }, list: [1, 2, 3] };
  const result = maskSensitiveValues(input, map);
  // No sensitive fields: the whole tree should flow through by reference.
  assert.equal(result, input);
  assert.equal(result.nested, input.nested);
  assert.equal(result.list, input.list);
});

test("maskSensitiveValues only clones the branches that change", () => {
  const map = generateFieldsToMaskMap();
  const clean = { city: "NYC" };
  const input = { user: { name: "Bob", password: "secret" }, address: clean };
  const result = maskSensitiveValues(input, map);
  // The changed branch is a fresh object...
  assert.notEqual(result, input);
  assert.notEqual(result.user, input.user);
  assert.equal(result.user.password, "******");
  // ...but untouched siblings keep their original reference.
  assert.equal(result.address, clean);
  // and the original is never mutated
  assert.equal(input.user.password, "secret");
});

test("maskSensitiveValues reuses an array reference when no element changes", () => {
  const map = generateFieldsToMaskMap();
  const input = [{ a: 1 }, { b: 2 }];
  assert.equal(maskSensitiveValues(input, map), input);
});
