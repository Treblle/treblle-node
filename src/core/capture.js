const { buildPayload } = require("./payload");
const {
  sendPayloadToTreblleApi,
  sendPayloadToTreblleApiAsync,
} = require("./transport");

/**
 * Builds the payload envelope from a snapshot and sends it to Treblle,
 * fire-and-forget. Never throws and never blocks the response path.
 *
 * @param {object} config normalized config from core/config.js
 * @param {object} snapshot see core/payload.js for the snapshot contract
 */
function captureAndSend(config, snapshot) {
  // No credentials — don't build or send anything.
  if (!config.enabled) return;
  const trebllePayload = buildPayload(config, snapshot);
  sendPayloadToTreblleApi({
    apiKey: config.sdkToken,
    trebllePayload,
    debug: config.debug,
    endpoint: config.ingressEndpoint,
  });
}

/**
 * Awaitable variant for adapters whose runtime needs the send to be kept
 * alive explicitly (e.g. Hono's `executionCtx.waitUntil`).
 *
 * @param {object} config normalized config from core/config.js
 * @param {object} snapshot see core/payload.js for the snapshot contract
 * @returns {Promise<void>}
 */
async function captureAndSendAsync(config, snapshot) {
  // No credentials — don't build or send anything.
  if (!config.enabled) return;
  const trebllePayload = buildPayload(config, snapshot);
  return sendPayloadToTreblleApiAsync({
    apiKey: config.sdkToken,
    trebllePayload,
    debug: config.debug,
    endpoint: config.ingressEndpoint,
  });
}

module.exports = {
  captureAndSend,
  captureAndSendAsync,
};
