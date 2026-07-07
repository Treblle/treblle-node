// Smoke test for the package.json "exports" map. Uses Node's package
// self-reference support, which resolves through the exports field exactly as
// consumers do.
const { test } = require("node:test");
const assert = require("node:assert/strict");

test("root export exposes the public API", () => {
  const root = require("treblle");
  for (const name of [
    "useTreblle",
    "useNestTreblle",
    "koaTreblle",
    "strapiTreblle",
    "honoTreblle",
    "useFastifyTreblle",
    "useNestFastifyTreblle",
    "trackQuery",
    "setMetadata",
  ]) {
    assert.equal(typeof root[name], "function", `${name} should be exported`);
  }
  assert.ok(Array.isArray(root.DEFAULT_MASKED_KEYWORDS));
});

test("framework subpaths resolve", () => {
  assert.equal(typeof require("treblle/express").useTreblle, "function");
  assert.equal(typeof require("treblle/express").useNestTreblle, "function");
  assert.equal(typeof require("treblle/koa").koaTreblle, "function");
  assert.equal(typeof require("treblle/strapi").strapiTreblle, "function");
  assert.equal(typeof require("treblle/hono").honoTreblle, "function");
  assert.equal(typeof require("treblle/fastify").useFastifyTreblle, "function");
  assert.equal(
    typeof require("treblle/fastify").useNestFastifyTreblle,
    "function",
  );
});

test("internal paths are not reachable through exports", () => {
  assert.throws(() => require("treblle/src/core/payload"), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
});
