const zlib = require("zlib");
const { promisify } = require("util");
const VERSION = require("../../package.json").version;

const gzipAsync = promisify(zlib.gzip);

// Only compress bodies at or above this size. Below it the gzip CPU cost and
// header overhead outweigh the bandwidth saved on already-tiny payloads.
const GZIP_MIN_BYTES = 1024;

/**
 * Compresses the outbound JSON body with gzip when it's large enough to be
 * worth it. Never throws — on any failure it falls back to the original
 * uncompressed string so a payload is always sent.
 *
 * @param {string} jsonBody serialized Treblle payload
 * @returns {Promise<{body: (string|Buffer), encoding: (string|null)}>}
 */
async function maybeGzipBody(jsonBody) {
  if (Buffer.byteLength(jsonBody) < GZIP_MIN_BYTES) {
    return { body: jsonBody, encoding: null };
  }
  try {
    const compressed = await gzipAsync(jsonBody);
    return { body: compressed, encoding: "gzip" };
  } catch (error) {
    // Compression failed; send the plain string instead.
    return { body: jsonBody, encoding: null };
  }
}

// Treblle ingress endpoint. All data is sent here unless a custom endpoint is
// configured (e.g. a region-specific ingress).
const TREBLLE_ENDPOINT = "https://ingress.treblle.com";

/**
 * Resolves the endpoint to send data to. Falls back to the default ingress
 * endpoint when no custom endpoint is configured. Accepts a full URL (e.g.
 * "https://ingress-eu.treblle.com").
 *
 * @param {string?} endpoint user-configured endpoint
 * @returns {string} the endpoint URL to send data to
 */
function resolveEndpoint(endpoint) {
  if (typeof endpoint === "string" && endpoint.trim() !== "") {
    return endpoint.trim();
  }
  return TREBLLE_ENDPOINT;
}

function sendPayloadToTreblleApi({ apiKey, trebllePayload, debug, endpoint }) {
  sendPayloadToTreblleApiAsync({
    apiKey,
    trebllePayload,
    debug,
    endpoint,
  }).then(
    () => {},
    () => {},
  );
}

async function sendPayloadToTreblleApiAsync({
  apiKey,
  trebllePayload,
  debug,
  endpoint,
}) {
  // Serialize up front. This can throw (e.g. a circular reference in a captured
  // body), and there's nothing to send if it does — log under debug and bail
  // instead of letting the rejection be swallowed by the fire-and-forget caller.
  let jsonBody;
  try {
    jsonBody = JSON.stringify(trebllePayload);
  } catch (error) {
    if (debug) {
      console.error("[error] Treblle could not serialize the payload", error);
    }
    return;
  }

  // Enforce a 5 second timeout on the send so a slow/hung ingress never keeps
  // the request path (or process) alive longer than necessary.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  const targetEndpoint = resolveEndpoint(endpoint);

  const { body, encoding } = await maybeGzipBody(jsonBody);

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "Accept-Encoding": "gzip, deflate",
    "User-Agent": `treblle-node/${VERSION}`,
  };
  if (encoding) {
    headers["Content-Encoding"] = encoding;
  }

  try {
    const response = await fetch(targetEndpoint, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (debug) {
      if (response.ok === false) {
        await logTreblleResponseError(response);
      } else {
        await logRequestSucceeded(response, targetEndpoint, jsonBody);
      }
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (debug) {
      await logRequestFailed(error);
    }
  }
}

async function logTreblleResponseError(response) {
  try {
    const responseBody = await response.json();
    logError(response, responseBody);
    return;
  } catch (_error) {
    // ignore _error here, it means the response wasn't JSON
  }

  try {
    const responseBody = await response.text();
    logError(response, responseBody);
    return;
  } catch (_error) {
    // ignore _error here, it means the response wasn't text
  }

  logError(response);
}

async function logRequestSucceeded(response, endpoint, jsonBody) {
  // The ingress returns 2xx even when it drops the payload (e.g. credentials
  // don't match a live project), so surface its response body too — it's the
  // best signal for "accepted 200 but nothing shows up in Treblle".
  let responseBody = "";
  try {
    responseBody = await response.text();
  } catch (_error) {
    // ignore — response body isn't readable
  }
  console.log(
    `[treblle] sent OK - status: ${response.statusText} (${response.status}) -> ${endpoint}` +
      (responseBody ? ` | ingress response: ${responseBody}` : ""),
  );
  // Full outbound payload (already masked) so you can confirm sdk_token /
  // api_key / sdk / data are what you expect. Opt-in via TREBLLE_DEBUG_PAYLOAD
  // to keep the default debug output readable.
  if (process.env.TREBLLE_DEBUG_PAYLOAD) {
    console.log(`[treblle] payload: ${jsonBody}`);
  }
}

function logError(response, responseBody) {
  console.log(
    `[error] Sending data to Treblle failed - status: ${response.statusText} (${response.status})`,
    responseBody,
  );
}

function logRequestFailed(error) {
  console.error(
    "[error] Sending data to Treblle failed (it's possibly a network error)",
    error,
  );
}

module.exports = {
  sendPayloadToTreblleApi,
  sendPayloadToTreblleApiAsync,
  maybeGzipBody,
  GZIP_MIN_BYTES,
  resolveEndpoint,
  TREBLLE_ENDPOINT,
};
