const { useTreblle, useNestTreblle } = require("./src/adapters/express");
const { koaTreblle, strapiTreblle } = require("./src/adapters/koa");
const { honoTreblle } = require("./src/adapters/hono");
const {
  useFastifyTreblle,
  useNestFastifyTreblle,
} = require("./src/adapters/fastify");

const { DEFAULT_MASKED_KEYWORDS } = require("./src/maskFields");

const { trackQuery } = require("./src/queryTracking");

const { setMetadata } = require("./src/metadata");

module.exports = {
  useTreblle,
  koaTreblle,
  strapiTreblle,
  useNestTreblle,
  honoTreblle,
  useFastifyTreblle,
  useNestFastifyTreblle,
  trackQuery,
  setMetadata,
  DEFAULT_MASKED_KEYWORDS,
};
