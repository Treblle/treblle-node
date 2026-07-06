const {
  useTreblle,
  koaTreblle,
  strapiTreblle,
  useNestTreblle,
  honoTreblle,
} = require("./src/treblle");

const {
  moduleWorkerTreblle,
} = require("./src/cloudflare-workers/module-worker-treblle");

const {
  serviceWorkerTreblle,
} = require("./src/cloudflare-workers/service-worker-treblle");

const { DEFAULT_MASKED_KEYWORDS } = require("./src/maskFields");

const { trackQuery } = require("./src/queryTracking");

module.exports = {
  useTreblle,
  koaTreblle,
  strapiTreblle,
  moduleWorkerTreblle,
  serviceWorkerTreblle,
  useNestTreblle,
  honoTreblle,
  trackQuery,
  DEFAULT_MASKED_KEYWORDS,
};
