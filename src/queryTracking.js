const { AsyncLocalStorage } = require("node:async_hooks");

// Upper bounds to keep the payload small and predictable. Queries past the cap
// are dropped silently; over-long SQL strings are truncated.
const MAX_QUERIES = 100;
const MAX_SQL_LENGTH = 2048;

/**
 * Request-scoped storage for tracked database queries. A store is opened per
 * request by the framework middleware (see `runWithQueryContext`) so that
 * `trackQuery` calls made anywhere during that request land in the right bucket.
 */
const queryStorage = new AsyncLocalStorage();

/**
 * Creates an empty per-request query store.
 * @returns {{ queries: Array<{ sql: string, time: number }> }}
 */
function createQueryStore() {
  return { queries: [] };
}

/**
 * Runs `fn` with `store` as the active query context. Any `trackQuery` call made
 * synchronously or in an awaited continuation of `fn` records into `store`.
 * @param {object} store store from `createQueryStore`
 * @param {function} fn function to run within the context
 * @returns {*} whatever `fn` returns
 */
function runWithQueryContext(store, fn) {
  return queryStorage.run(store, fn);
}

/**
 * Best-effort scrubbing of inline literal values from a SQL string so no
 * sensitive data leaks into the payload. Replaces single-quoted string literals
 * and standalone numeric literals with `?`. This is a safety net: when queries
 * come from an ORM's query event the SQL is already parameterized (bindings are
 * kept separate), so this typically leaves it unchanged.
 * @param {string} sql
 * @returns {string}
 */
function sanitizeSql(sql) {
  if (typeof sql !== "string") return "";
  return sql
    // single-quoted string literals, handling escaped quotes
    .replace(/'(?:[^'\\]|\\.)*'/g, "?")
    // standalone numeric literals — but not parts of identifiers (`col1`) or
    // positional/named placeholders (`$1`, `:1`) which must be preserved
    .replace(/(?<![\w$:])\d+(?:\.\d+)?\b/g, "?");
}

/**
 * Coerces a query duration into a finite, non-negative number of milliseconds.
 * @param {*} time
 * @returns {number}
 */
function normalizeTime(time) {
  const n = Number(time);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Records a database query against the active request. Safe to call from
 * anywhere; it is a no-op when there is no active request context (e.g. queries
 * made outside a request, or when the framework isn't wired up).
 *
 * Store only the parameterized SQL string — never the parameter bindings — so
 * that sensitive values are not captured.
 * @param {string} sql the (parameterized) SQL query string
 * @param {number} time query execution time in milliseconds
 */
function trackQuery(sql, time) {
  const store = queryStorage.getStore();
  if (!store || !Array.isArray(store.queries)) return;
  if (store.queries.length >= MAX_QUERIES) return;

  let cleanSql = sanitizeSql(String(sql));
  if (cleanSql.length > MAX_SQL_LENGTH) {
    cleanSql = cleanSql.slice(0, MAX_SQL_LENGTH);
  }

  store.queries.push({ sql: cleanSql, time: normalizeTime(time) });
}

/**
 * Returns the queries recorded on a store, or an empty array.
 * @param {object} store store from `createQueryStore`
 * @returns {Array<{ sql: string, time: number }>}
 */
function getTrackedQueries(store) {
  return store && Array.isArray(store.queries) ? store.queries : [];
}

module.exports = {
  MAX_QUERIES,
  MAX_SQL_LENGTH,
  createQueryStore,
  runWithQueryContext,
  trackQuery,
  getTrackedQueries,
  sanitizeSql,
  normalizeTime,
};
