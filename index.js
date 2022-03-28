const { useTreblle, koaTreblle, strapiTreblle } = require("./src/treblle");

const {
  moduleWorkerTreblle,
} = require("./src/cloudflare-workers/module-worker-treblle");

const {
  serviceWorkerTreblle,
} = require("./src/cloudflare-workers/service-worker-treblle");

module.exports = {
  useTreblle,
  koaTreblle,
  strapiTreblle,
  moduleWorkerTreblle,
  serviceWorkerTreblle,
};
