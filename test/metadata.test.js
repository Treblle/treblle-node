const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  createQueryStore,
  runWithQueryContext,
} = require("../src/queryTracking");
const {
  setMetadata,
  getMetadata,
  MAX_METADATA_KEYS,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_VALUE_LENGTH,
} = require("../src/metadata");

/**
 * Runs `fn` inside a fresh request context and returns the metadata collected on
 * that request's store — the same path the adapters use in production.
 */
function collect(fn) {
  const store = createQueryStore();
  runWithQueryContext(store, fn);
  return getMetadata(store);
}

test("setMetadata(key, value) records a single pair", () => {
  const metadata = collect(() => setMetadata("user-id", "john"));
  assert.deepEqual(metadata, { "user-id": "john" });
});

test("setMetadata(object) records multiple pairs", () => {
  const metadata = collect(() =>
    setMetadata({ plan: "premium", region: "eu" }),
  );
  assert.deepEqual(metadata, { plan: "premium", region: "eu" });
});

test("both call shapes merge into one metadata object", () => {
  const metadata = collect(() => {
    setMetadata("user-id", "john");
    setMetadata({ plan: "premium", region: "eu" });
  });
  assert.deepEqual(metadata, {
    "user-id": "john",
    plan: "premium",
    region: "eu",
  });
});

test("a later value overwrites an earlier one for the same key", () => {
  const metadata = collect(() => {
    setMetadata("plan", "free");
    setMetadata("plan", "premium");
  });
  assert.deepEqual(metadata, { plan: "premium" });
});

test("keeps finite numbers and booleans as-is", () => {
  const metadata = collect(() => {
    setMetadata("count", 42);
    setMetadata("active", true);
    setMetadata("ratio", 3.14);
  });
  assert.deepEqual(metadata, { count: 42, active: true, ratio: 3.14 });
});

test("is a silent no-op when there is no active request context", () => {
  assert.doesNotThrow(() => setMetadata("user-id", "john"));
  assert.doesNotThrow(() => setMetadata({ plan: "premium" }));
});

test("drops keys once the per-request cap is reached", () => {
  const metadata = collect(() => {
    for (let i = 0; i < MAX_METADATA_KEYS + 5; i++) {
      setMetadata(`key-${i}`, i);
    }
  });
  assert.equal(Object.keys(metadata).length, MAX_METADATA_KEYS);
  // The first MAX_METADATA_KEYS keys win; later new keys are dropped.
  assert.equal(metadata["key-0"], 0);
  assert.equal(metadata[`key-${MAX_METADATA_KEYS}`], undefined);
});

test("overwriting an existing key still works at the cap", () => {
  const metadata = collect(() => {
    for (let i = 0; i < MAX_METADATA_KEYS; i++) {
      setMetadata(`key-${i}`, i);
    }
    // Bucket is full, but this is an existing key so it may still be updated.
    setMetadata("key-0", "updated");
    // A brand-new key is still dropped.
    setMetadata("overflow", "nope");
  });
  assert.equal(metadata["key-0"], "updated");
  assert.equal(metadata.overflow, undefined);
});

test("truncates over-long keys", () => {
  const longKey = "k".repeat(MAX_METADATA_KEY_LENGTH + 50);
  const metadata = collect(() => setMetadata(longKey, "v"));
  const [storedKey] = Object.keys(metadata);
  assert.equal(storedKey.length, MAX_METADATA_KEY_LENGTH);
});

test("truncates over-long string values", () => {
  const longValue = "v".repeat(MAX_METADATA_VALUE_LENGTH + 50);
  const metadata = collect(() => setMetadata("note", longValue));
  assert.equal(metadata.note.length, MAX_METADATA_VALUE_LENGTH);
});

test("drops empty, whitespace-only, and non-string keys", () => {
  const metadata = collect(() => {
    setMetadata("", "x");
    setMetadata("   ", "x");
    setMetadata(123, "x");
    setMetadata(null, "x");
  });
  assert.deepEqual(metadata, {});
});

test("trims surrounding whitespace from keys", () => {
  const metadata = collect(() => setMetadata("  user-id  ", "john"));
  assert.deepEqual(metadata, { "user-id": "john" });
});

test("drops non-primitive and non-finite values", () => {
  const metadata = collect(() => {
    setMetadata("obj", { nested: true });
    setMetadata("arr", [1, 2, 3]);
    setMetadata("nil", null);
    setMetadata("undef", undefined);
    setMetadata("nan", NaN);
    setMetadata("inf", Infinity);
    setMetadata("big", 10n);
  });
  assert.deepEqual(metadata, {});
});

test("skips only the invalid pairs in an object, keeping valid ones", () => {
  const metadata = collect(() =>
    setMetadata({ plan: "premium", bad: { x: 1 }, count: 3 }),
  );
  assert.deepEqual(metadata, { plan: "premium", count: 3 });
});
