const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_QUERIES,
  MAX_SQL_LENGTH,
  createQueryStore,
  runWithQueryContext,
  trackQuery,
  getTrackedQueries,
  sanitizeSql,
  normalizeTime,
} = require("../src/queryTracking");

test("trackQuery is a no-op outside a request context", () => {
  // Should not throw and should record nothing anywhere.
  assert.doesNotThrow(() => trackQuery("SELECT 1", 5));
});

test("trackQuery records queries in order within a context", () => {
  const store = createQueryStore();
  runWithQueryContext(store, () => {
    trackQuery("SELECT * FROM users WHERE id = $1", 12);
    trackQuery("SELECT * FROM posts", 3);
  });

  assert.deepEqual(getTrackedQueries(store), [
    { sql: "SELECT * FROM users WHERE id = $1", time: 12 },
    { sql: "SELECT * FROM posts", time: 3 },
  ]);
});

test("trackQuery respects the MAX_QUERIES cap", () => {
  const store = createQueryStore();
  runWithQueryContext(store, () => {
    for (let i = 0; i < MAX_QUERIES + 25; i++) {
      trackQuery("SELECT 1", 1);
    }
  });
  assert.equal(getTrackedQueries(store).length, MAX_QUERIES);
});

test("trackQuery truncates over-long SQL", () => {
  const store = createQueryStore();
  const longSql = "SELECT " + "a".repeat(MAX_SQL_LENGTH * 2);
  runWithQueryContext(store, () => {
    trackQuery(longSql, 1);
  });
  assert.equal(getTrackedQueries(store)[0].sql.length, MAX_SQL_LENGTH);
});

test("sanitizeSql replaces single-quoted string literals with ?", () => {
  assert.equal(
    sanitizeSql("SELECT * FROM users WHERE email = 'alice@example.com'"),
    "SELECT * FROM users WHERE email = ?"
  );
});

test("sanitizeSql replaces standalone numeric literals with ?", () => {
  assert.equal(
    sanitizeSql("SELECT * FROM users WHERE age > 18 AND score = 4.5"),
    "SELECT * FROM users WHERE age > ? AND score = ?"
  );
});

test("sanitizeSql leaves identifiers and positional/named placeholders intact", () => {
  assert.equal(
    sanitizeSql("SELECT col1, col2 FROM users WHERE id = $1"),
    "SELECT col1, col2 FROM users WHERE id = $1"
  );
  assert.equal(
    sanitizeSql("SELECT * FROM t WHERE id = :1"),
    "SELECT * FROM t WHERE id = :1"
  );
});

test("sanitizeSql handles escaped quotes inside string literals", () => {
  assert.equal(
    sanitizeSql("SELECT * FROM t WHERE name = 'O\\'Brien'"),
    "SELECT * FROM t WHERE name = ?"
  );
});

test("normalizeTime clamps invalid input to 0", () => {
  assert.equal(normalizeTime(42), 42);
  assert.equal(normalizeTime("15.5"), 15.5);
  assert.equal(normalizeTime(-3), 0);
  assert.equal(normalizeTime(NaN), 0);
  assert.equal(normalizeTime(undefined), 0);
  assert.equal(normalizeTime("not-a-number"), 0);
});

test("trackQuery sanitizes recorded SQL", () => {
  const store = createQueryStore();
  runWithQueryContext(store, () => {
    trackQuery("SELECT * FROM users WHERE email = 'a@b.com'", 7);
  });
  assert.deepEqual(getTrackedQueries(store), [
    { sql: "SELECT * FROM users WHERE email = ?", time: 7 },
  ]);
});
