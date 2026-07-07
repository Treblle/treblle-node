const { generateFieldsToMaskMap } = require("../maskFields");

/**
 * Normalizes and validates the user-facing Treblle options into the internal
 * config object shared by every framework adapter. This is the single place
 * where option defaults live.
 *
 * @param {object} options
 * @param {string} options.sdkToken Treblle SDK token (sent as `sdk_token`)
 * @param {string} options.apiKey Treblle API key (sent as `api_key`)
 * @param {string[]?} options.maskedKeywords keywords to mask; replaces the
 *   default list, `[]` turns masking off, omitted uses the defaults
 * @param {(string[]|RegExp)?} options.blockedPaths paths to exclude from tracking
 * @param {boolean?} options.debug controls error logging when sending data to Treblle
 * @param {string?} options.ingressEndpoint custom Treblle ingress endpoint
 *   (e.g. "https://ingress-eu.treblle.com")
 * @param {{ sdk: string }} meta sdk name reported in the payload envelope
 * @returns {object} normalized config consumed by core and adapters
 */
function normalizeConfig(options, { sdk }) {
  const {
    sdkToken,
    apiKey,
    maskedKeywords,
    blockedPaths = [],
    debug = false,
    ingressEndpoint,
    ...extras
  } = options || {};

  if (debug && (!sdkToken || !apiKey)) {
    console.warn(
      "Treblle: `sdkToken` and `apiKey` are both required — data will not show up in Treblle without them.",
    );
  }

  return {
    sdkToken,
    apiKey,
    // Without both credentials there is nothing Treblle can do with the data, so
    // the send path skips entirely (see core/capture.js). The `debug` warning
    // above is the only signal emitted in that case.
    enabled: Boolean(sdkToken && apiKey),
    sdk,
    // Computed once at setup; `undefined` keeps the default masked keywords,
    // an explicit empty array disables masking.
    fieldsToMaskMap: generateFieldsToMaskMap(maskedKeywords),
    blockedPaths,
    debug,
    ingressEndpoint,
    // Adapter-specific options (e.g. Strapi's ignoreAdminRoutes) pass through.
    extras,
  };
}

module.exports = {
  normalizeConfig,
};
