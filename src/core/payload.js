const os = require("os");
const stackTrace = require("stack-trace");
const { maskSensitiveValues } = require("../maskFields");
const { redactBufferBody } = require("./files");
const { checkPayloadSize } = require("./sizeLimit");
const { getRequestDuration } = require("./timing");
const { MAX_QUERIES } = require("../queryTracking");

/**
 * Treblle API payload version - this should be incremented whenever the payload structure changes
 * to ensure backward compatibility with older SDKs.
 * The current version is 30 which would map to 3.0
 */
const PAYLOAD_VERSION = 30;

// Upper bound on errors included in a single payload. Extra errors past the cap
// are dropped so the payload stays small and predictable.
const MAX_ERRORS = 25;

// Cache expensive operations at module load
const CACHED_OS_INFO = {
  name: os.platform(),
  release: os.release(),
  architecture: os.arch(),
};
const CACHED_NODE_VERSION = process.version;
const CACHED_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Formats the current time as "YYYY-MM-DD HH:MM:SS" (UTC). Computed per request
// so timestamps stay accurate and preserve request ordering — the cost of a
// single Date/ISO conversion per payload is negligible.
function getTimestamp() {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

function getPayload(payload) {
  if (typeof payload === "object") return payload;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch (error) {
      // if we can't parse it we'll just return null
      return null;
    }
  }
}

/**
 * Masks the values of sensitive query-string parameters in a URL. The parsed
 * query object is masked separately (it becomes the GET request body), but the
 * `url` field embeds the raw query string, so `/login?token=abc` would leak the
 * value unless we mask it here too. Only the values of keys matching the mask
 * map are replaced (with asterisks); the path and non-sensitive params are left
 * untouched. Returns the URL unchanged when masking is disabled or there is no
 * query string.
 *
 * @param {string} url full request URL
 * @param {object|null} fieldsToMaskMap lookup map, or null when masking is off
 * @returns {string} the URL with sensitive query values masked
 */
function maskUrlQueryString(url, fieldsToMaskMap) {
  if (!fieldsToMaskMap || typeof url !== "string") return url;

  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return url;

  const base = url.slice(0, queryIndex);
  const hashIndex = url.indexOf("#", queryIndex);
  const query =
    hashIndex === -1
      ? url.slice(queryIndex + 1)
      : url.slice(queryIndex + 1, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);

  let changed = false;
  const maskedPairs = query.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return pair;

    const rawKey = pair.slice(0, eq);
    let key;
    try {
      key = decodeURIComponent(rawKey).toLowerCase();
    } catch {
      key = rawKey.toLowerCase();
    }

    if (fieldsToMaskMap[key] === true) {
      changed = true;
      const value = pair.slice(eq + 1);
      return `${rawKey}=${"*".repeat(value.length)}`;
    }
    return pair;
  });

  if (!changed) return url;
  return `${base}?${maskedPairs.join("&")}${hash}`;
}

/**
 * Transforms route paths from :param syntax to OpenAPI {param} format
 * @param {string} routePath Route path with :param syntax
 * @returns {string} Route path with {param} syntax
 */
function transformToOpenAPIFormat(routePath) {
  // Transform :param to {param} and :param? to {param} (optional params)
  return routePath.replace(/:([a-zA-Z_$][a-zA-Z0-9_$]*)\??/g, "{$1}");
}

// Marker body used in place of a response body that isn't valid JSON. Treblle
// only stores JSON request/response bodies, so anything else (HTML, plain text,
// a malformed JSON string) is swapped for this marker rather than shipping the
// raw payload or recording an error.
const INVALID_JSON_RESPONSE_BODY = {
  message: "Invalid JSON returned in response body",
};

/**
 * Runs the raw response body through the shared pipeline: Buffers are decoded
 * to utf8, strings must parse as JSON, and the result is size-checked and
 * masked. A non-JSON body is gracefully replaced with a small marker object
 * (no error is recorded — Treblle simply doesn't store non-JSON bodies).
 *
 * @returns {*} masked body, the invalid-JSON marker, or undefined when there is
 *   no usable body
 */
function processResponseBody(rawBody, fieldsToMaskMap) {
  let body = rawBody;
  // if the response is streamed it could be a buffer
  // so we'll convert it to a string first
  if (Buffer.isBuffer(body)) {
    body = body.toString("utf8");
  }

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return INVALID_JSON_RESPONSE_BODY;
    }
  } else if (typeof body !== "object") {
    return undefined;
  }

  return maskSensitiveValues(
    checkPayloadSize(body, "response"),
    fieldsToMaskMap,
  );
}

/**
 * Builds the UNHANDLED_EXCEPTION error entry from a caught exception.
 */
function buildExceptionError(error) {
  const trace = stackTrace.parse(error);
  const topFrame = Array.isArray(trace) && trace.length > 0 ? trace[0] : null;

  return {
    source: "onException",
    type: "UNHANDLED_EXCEPTION",
    message: error && error.message ? error.message : String(error),
    file: topFrame ? topFrame.getFileName() : null,
    line: topFrame ? topFrame.getLineNumber() : null,
  };
}

/**
 * Builds the Treblle payload envelope from a normalized request/response
 * snapshot. This is the single place the wire format is defined — every
 * framework adapter feeds it the same snapshot shape:
 *
 * {
 *   protocol,                                   // e.g. "HTTP/1.1"
 *   request:  { ip, url, userAgent, method, headers, body, routePath },
 *   response: { statusCode, headers, body, size },
 *   error,                                      // caught exception, optional
 *   queries,                                    // tracked DB queries, optional
 *   metadata,                                   // custom key/value pairs, optional
 *   startTime,                                  // from timing.createStartTime()
 * }
 *
 * Headers and bodies arrive unmasked and raw; masking, JSON parsing, size
 * checks, error entries, timing math, and route normalization all happen here.
 *
 * @param {object} config normalized config from core/config.js
 * @param {object} snapshot see above
 * @returns {object} the payload envelope to send to Treblle
 */
function buildPayload(config, snapshot) {
  const { fieldsToMaskMap } = config;
  const errors = [];

  // A raw binary body (Buffer) is collapsed to a { name, type, size } descriptor
  // so we never ship the bytes (or serialize them as a giant byte-index object).
  const requestBody = redactBufferBody(
    getPayload(snapshot.request.body),
    snapshot.request.headers && snapshot.request.headers["content-type"],
  );

  const maskedRequestBody = maskSensitiveValues(
    checkPayloadSize(requestBody, "request"),
    fieldsToMaskMap,
  );

  const maskedResponseBody = processResponseBody(
    snapshot.response.body,
    fieldsToMaskMap,
  );

  if (snapshot.error) {
    errors.push(buildExceptionError(snapshot.error));
  }

  return {
    sdk_token: config.sdkToken,
    api_key: config.apiKey,
    version: PAYLOAD_VERSION,
    sdk: config.sdk,
    data: {
      server: {
        timezone: CACHED_TIMEZONE,
        os: CACHED_OS_INFO,
        software: null,
        signature: null,
        protocol: snapshot.protocol,
      },
      language: {
        name: "node",
        version: CACHED_NODE_VERSION,
      },
      request: {
        timestamp: getTimestamp(),
        ip: snapshot.request.ip,
        url: maskUrlQueryString(snapshot.request.url, fieldsToMaskMap),
        user_agent: snapshot.request.userAgent,
        method: snapshot.request.method,
        headers: maskSensitiveValues(snapshot.request.headers, fieldsToMaskMap),
        body: maskedRequestBody !== undefined ? maskedRequestBody : null,
        route_path: snapshot.request.routePath
          ? transformToOpenAPIFormat(snapshot.request.routePath)
          : null,
      },
      response: {
        headers: maskSensitiveValues(
          snapshot.response.headers,
          fieldsToMaskMap,
        ),
        code: snapshot.response.statusCode,
        size: snapshot.response.size,
        load_time: getRequestDuration(snapshot.startTime),
        body: maskedResponseBody !== undefined ? maskedResponseBody : null,
      },
      errors: errors.slice(0, MAX_ERRORS),
      queries: Array.isArray(snapshot.queries)
        ? snapshot.queries.slice(0, MAX_QUERIES)
        : [],
      // Custom key/value pairs set by the app via `setMetadata`. Already
      // limited/normalized at write time (see src/metadata.js) and not masked.
      metadata:
        snapshot.metadata && typeof snapshot.metadata === "object"
          ? snapshot.metadata
          : {},
    },
  };
}

module.exports = {
  PAYLOAD_VERSION,
  buildPayload,
  getPayload,
  transformToOpenAPIFormat,
  maskUrlQueryString,
};
