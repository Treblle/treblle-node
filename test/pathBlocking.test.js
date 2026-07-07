const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isPathBlocked, extractPathname } = require("../src/core/blocklist");

test("extractPathname strips query strings from plain paths", () => {
  assert.equal(extractPathname("/robots.txt?foo=1"), "/robots.txt");
  assert.equal(extractPathname("/api/users?x=1&y=2"), "/api/users");
});

test("extractPathname strips hash fragments", () => {
  assert.equal(extractPathname("/page#section"), "/page");
});

test("extractPathname extracts pathname from absolute URLs (Hono style)", () => {
  assert.equal(
    extractPathname("http://localhost:3000/robots.txt?a=b"),
    "/robots.txt"
  );
  assert.equal(extractPathname("https://ex.com/static/app.css"), "/static/app.css");
});

test("extractPathname leaves clean paths unchanged", () => {
  assert.equal(extractPathname("/api/users"), "/api/users");
});

test("extractPathname passes through non-strings", () => {
  assert.equal(extractPathname(undefined), undefined);
  assert.equal(extractPathname(null), null);
});

test("isPathBlocked blocks default static asset patterns", () => {
  assert.equal(isPathBlocked("/favicon.ico"), true);
  assert.equal(isPathBlocked("/robots.txt"), true);
  assert.equal(isPathBlocked("/static/app.js"), true);
  assert.equal(isPathBlocked("/assets/logo.png"), true);
  assert.equal(isPathBlocked("/styles/main.css"), true);
});

test("isPathBlocked allows normal API paths by default", () => {
  assert.equal(isPathBlocked("/api/users"), false);
  assert.equal(isPathBlocked("/v1/orders/123"), false);
});

test("isPathBlocked honors a string blocklist (prefix and exact match)", () => {
  assert.equal(isPathBlocked("/health", ["health"]), true);
  assert.equal(isPathBlocked("/health/live", ["health"]), true);
  assert.equal(isPathBlocked("/api/users", ["health"]), false);
});

test("isPathBlocked honors a RegExp blocklist", () => {
  assert.equal(isPathBlocked("/internal/metrics", /^\/internal\//), true);
  // /orders is neither in the user regex nor a default-blocked pattern
  assert.equal(isPathBlocked("/orders/metrics", /^\/internal\//), false);
});

test("isPathBlocked honors an array containing RegExp entries", () => {
  assert.equal(isPathBlocked("/debug/info", [/^\/debug/]), true);
  assert.equal(isPathBlocked("/prod/info", [/^\/debug/, "admin"]), false);
});

test("isPathBlocked always applies default patterns (not configurable)", () => {
  // Defaults are always on — there is no opt-out.
  assert.equal(isPathBlocked("/favicon.ico"), true);
  assert.equal(isPathBlocked("/favicon.ico", ["health"]), true);
  // user blocked paths are applied on top of the defaults
  assert.equal(isPathBlocked("/health", ["health"]), true);
});

test("anchored default patterns match after query strings are normalized away", () => {
  // Regression guard for #10: query strings previously broke anchored patterns.
  assert.equal(isPathBlocked(extractPathname("/robots.txt?v=2")), true);
  assert.equal(
    isPathBlocked(extractPathname("http://localhost/favicon.ico?x=1")),
    true
  );
});
