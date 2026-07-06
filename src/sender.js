const { maskSensitiveValues } = require("./maskFields");
const os = require("os");
const stackTrace = require("stack-trace");
const VERSION = require("../package.json").version;

/**
 * Treblle API payload version - this should be incremented whenever the payload structure changes
 * to ensure backward compatibility with older SDKs.
 * The current version is 20 which would map to 2.0
 */
const PAYLOAD_VERSION = 20;

const http = require("http");
const https = require("https");

// Try to import node-fetch (only needed in Node.js environments)
let nodeFetch = null;
try {
  nodeFetch = require("node-fetch");
} catch (error) {
  // node-fetch not available, will use runtime fetch detection
}

// Try to import Hono route helpers (optional dependency)
let honoRouteHelpers = null;
try {
  honoRouteHelpers = require("hono/route");
} catch (error) {
  // Hono route helpers not available, will use fallback methods
}

// Try to load zlib for outbound compression. Available in Node.js and in
// Cloudflare Workers when `nodejs_compat` is enabled; absent otherwise, in
// which case we transparently fall back to sending uncompressed JSON.
let gzipAsync = null;
try {
  const zlib = require("zlib");
  const { promisify } = require("util");
  gzipAsync = promisify(zlib.gzip);
} catch (error) {
  // zlib unavailable in this runtime; payloads are sent uncompressed.
}

// Only compress bodies at or above this size. Below it the gzip CPU cost and
// header overhead outweigh the bandwidth saved on already-tiny payloads.
const GZIP_MIN_BYTES = 1024;

/**
 * Compresses the outbound JSON body with gzip when it's large enough to be
 * worth it and zlib is available in this runtime. Never throws — on any
 * failure it falls back to the original uncompressed string so a payload is
 * always sent.
 *
 * @param {string} jsonBody serialized Treblle payload
 * @returns {Promise<{body: (string|Buffer), encoding: (string|null)}>}
 */
async function maybeGzipBody(jsonBody) {
  if (!gzipAsync || Buffer.byteLength(jsonBody) < GZIP_MIN_BYTES) {
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

// Cache expensive operations at module load
const CACHED_OS_INFO = {
  name: os.platform(),
  release: os.release(),
  architecture: os.arch(),
};
const CACHED_NODE_VERSION = process.version;
const CACHED_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// HTTP Agents with connection pooling and keep-alive.
//
// These only apply to the node-fetch code path. Native/undici `fetch` (Node 18+)
// ignores the `agent` option entirely and does its own connection pooling, so on
// modern runtimes these are never used. Create them lazily to avoid allocating
// two Agent objects (each with its own keep-alive timer) on the common native
// path where they'd sit idle forever.
let HTTP_AGENT = null;
let HTTPS_AGENT = null;
function getAgent(protocol) {
  if (protocol === "https:") {
    if (!HTTPS_AGENT) {
      HTTPS_AGENT = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 10,
        maxFreeSockets: 5,
        timeout: 5000,
      });
    }
    return HTTPS_AGENT;
  }
  if (!HTTP_AGENT) {
    HTTP_AGENT = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000, // 30 seconds
      maxSockets: 10,
      maxFreeSockets: 5,
      timeout: 5000, // 5 second socket timeout
    });
  }
  return HTTP_AGENT;
}

// Treblle ingress endpoint. All data is sent here.
const TREBLLE_ENDPOINT = "https://ingress.treblle.com";

// Retained as an array (single entry) for backward compatibility with
// consumers/tests that expect a list of known endpoints.
const TREBLLE_ENDPOINTS = [TREBLLE_ENDPOINT];

function getRandomEndpoint() {
  return TREBLLE_ENDPOINT;
}

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

// Cache for timestamps to reduce Date object creation
let lastTimestamp = null;
let lastTimestampTime = 0;
const TIMESTAMP_CACHE_MS = 1000; // Cache for 1 second

function getCachedTimestamp() {
  const now = Date.now();
  if (!lastTimestamp || now - lastTimestampTime > TIMESTAMP_CACHE_MS) {
    lastTimestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
    lastTimestampTime = now;
  }
  return lastTimestamp;
}

// Payload size limits and helpers
const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB in bytes
const PAYLOAD_TOO_LARGE_MESSAGE = {
  message: "Treblle only captures requests and responses up to 5MB",
  actual_size_bytes: null,
};

function estimateObjectSize(obj, visited = new WeakSet()) {
  if (!obj || typeof obj !== "object" || visited.has(obj)) return 0;
  visited.add(obj);

  let size = 0;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === "string") {
        size += Buffer.byteLength(item, "utf8");
      } else if (typeof item === "object") {
        size += estimateObjectSize(item, visited);
      } else {
        size += 8; // rough estimate for primitives
      }

      // Early exit if we exceed limit
      if (size > MAX_PAYLOAD_SIZE) return size;
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      size += Buffer.byteLength(key, "utf8"); // key size

      if (typeof value === "string") {
        size += Buffer.byteLength(value, "utf8");
      } else if (typeof value === "object") {
        size += estimateObjectSize(value, visited);
      } else {
        size += 8; // rough estimate for primitives
      }

      // Early exit if we exceed limit
      if (size > MAX_PAYLOAD_SIZE) return size;
    }
  }

  return size;
}

function getPayloadSize(payload) {
  if (!payload) return 0;
  if (typeof payload === "string") {
    return Buffer.byteLength(payload, "utf8");
  }
  if (Buffer.isBuffer(payload)) {
    return payload.length;
  }
  // Fast recursive estimation without full serialization
  return estimateObjectSize(payload);
}

function checkPayloadSize(payload) {
  const size = getPayloadSize(payload);
  if (size > MAX_PAYLOAD_SIZE) {
    return {
      ...PAYLOAD_TOO_LARGE_MESSAGE,
      actual_size_bytes: size,
    };
  }
  return payload;
}

/**
 * Prepares the payload which is sent to Treblle.
 *
 * @param {object} Express request object
 * @param {object} Express response object
 * @param {object} settings
 * @param {string} settings.sdkToken Treblle SDK token
 * @param {string} settings.apiKey Treblle API key
 * @param {number[]} settings.requestStartTime when the request started
 * @param {object} settings.fieldsToMaskMap map of fields to mask
 */
const generateTrebllePayload = function (
  req,
  res,
  { sdkToken, apiKey, requestStartTime, error, fieldsToMaskMap, queries, sdk = "express" }
) {
  const payload = req.method === "GET" ? req.query : req.body;
  const parsedPayload = getPayload(payload);
  const sizeCheckedPayload = checkPayloadSize(parsedPayload);
  const maskedRequestPayload = maskSensitiveValues(
    sizeCheckedPayload,
    fieldsToMaskMap
  );

  const responseHeaders = res.getHeaders();

  let errors = [];

  // We should be able to parse this, but you never know if users will try doing something weird...
  let maskedResponseBody;
  let parsedResponseBody;
  try {
    let originalResponseBody = res.__treblle_body_response;
    // if the response is streamed it could be a buffer
    // so we'll convert it to a string first
    if (Buffer.isBuffer(originalResponseBody)) {
      originalResponseBody = originalResponseBody.toString("utf8");
    }

    if (typeof originalResponseBody === "string") {
      parsedResponseBody = JSON.parse(originalResponseBody);
      const sizeCheckedResponseBody = checkPayloadSize(parsedResponseBody);
      maskedResponseBody = maskSensitiveValues(
        sizeCheckedResponseBody,
        fieldsToMaskMap
      );
    } else if (typeof originalResponseBody === "object") {
      const sizeCheckedResponseBody = checkPayloadSize(originalResponseBody);
      maskedResponseBody = maskSensitiveValues(
        sizeCheckedResponseBody,
        fieldsToMaskMap
      );
    }
  } catch {
    // if we can't parse the body we'll leave it empty and set an error
    errors.push({
      source: "onShutdown",
      type: "INVALID_JSON",
      message: "Invalid JSON format",
      file: null,
      line: null,
    });
  }

  const protocol = `${req.protocol.toUpperCase()}/${req.httpVersion}`;

  // get rid of the workaround body, we don't need it anymore
  delete res.__treblle_body_response;

  if (error) {
    const trace = stackTrace.parse(error);
    const topFrame = Array.isArray(trace) && trace.length > 0 ? trace[0] : null;

    errors.push({
      source: "onException",
      type: "UNHANDLED_EXCEPTION",
      message: error && error.message ? error.message : String(error),
      file: topFrame ? topFrame.getFileName() : null,
      line: topFrame ? topFrame.getLineNumber() : null,
    });
  }

  let dataToSend = {
    api_key: sdkToken,
    project_id: apiKey,
    version: PAYLOAD_VERSION,
    sdk: sdk,
    data: {
      server: {
        timezone: CACHED_TIMEZONE,
        os: CACHED_OS_INFO,
        software: null,
        signature: null,
        protocol: protocol,
      },
      language: {
        name: "node",
        version: CACHED_NODE_VERSION,
      },
      request: {
        timestamp: getCachedTimestamp(),
        ip: req.ip,
        url: getRequestUrl(req),
        user_agent: req.get("user-agent"),
        method: req.method,
        headers: maskSensitiveValues(req.headers, fieldsToMaskMap),
        body: maskedRequestPayload !== undefined ? maskedRequestPayload : null,
        route_path: getRoutePath(req),
      },
      response: {
        headers: maskSensitiveValues(responseHeaders, fieldsToMaskMap),
        code: res.statusCode,
        size: res._contentLength,
        load_time: getRequestDuration(requestStartTime),
        body: maskedResponseBody !== undefined ? maskedResponseBody : null,
      },
      errors: errors,
      queries: Array.isArray(queries) ? queries : [],
    },
  };

  return dataToSend;
};

/**
 * Prepares the payload which is sent to Treblle.
 *
 * @param {object} Hono context object
 * @param {object} settings
 * @param {string} settings.sdkToken Treblle SDK token
 * @param {string} settings.apiKey Treblle API key
 * @param {number[]} settings.requestStartTime when the request started
 * @param {object} settings.fieldsToMaskMap map of fields to mask
 */
const generateHonoTrebllePayload = function (
  honoContext,
  { sdkToken, apiKey, requestStartTime, error, fieldsToMaskMap, queries }
) {
  const payload =
    honoContext.req.method === "GET"
      ? honoContext.req.queries()
      : honoContext.__treblle_body_request
  const parsedPayload = getPayload(payload);
  const sizeCheckedPayload = checkPayloadSize(parsedPayload);
  const maskedRequestPayload = maskSensitiveValues(
    sizeCheckedPayload,
    fieldsToMaskMap
  );

  let responseBodySize = honoContext.__treblle_body_response_size || null;
  
  let errors = [];

  let maskedResponseBody;
  let parsedResponseBody;
  try {
    let originalResponseBody = honoContext.__treblle_body_response;
    // if the response is streamed it could be a buffer
    // so we'll convert it to a string first
    if (Buffer.isBuffer(originalResponseBody)) {
      originalResponseBody = originalResponseBody.toString("utf8");
    }

    if (typeof originalResponseBody === "string") {
      parsedResponseBody = JSON.parse(originalResponseBody);
      const sizeCheckedResponseBody = checkPayloadSize(parsedResponseBody);
      maskedResponseBody = maskSensitiveValues(
        sizeCheckedResponseBody,
        fieldsToMaskMap
      );
    } else if (typeof originalResponseBody === "object") {
      const sizeCheckedResponseBody = checkPayloadSize(originalResponseBody);
      maskedResponseBody = maskSensitiveValues(
        sizeCheckedResponseBody,
        fieldsToMaskMap
      );
    }
  } catch {
    // if we can't parse the body we'll leave it empty and set an error
    responseBodySize = null;
    errors.push({
      source: "onShutdown",
      type: "INVALID_JSON",
      message: "Invalid JSON format",
      file: null,
      line: null,
    });
  }

  // Hono uses HTTP/1.1 by default, but we'll try to detect version
  const protocol = "HTTP/1.1";

  if (error) {
    const trace = stackTrace.parse(error);
    const topFrame = Array.isArray(trace) && trace.length > 0 ? trace[0] : null;

    errors.push({
      source: "onException",
      type: "UNHANDLED_EXCEPTION",
      message: error && error.message ? error.message : String(error),
      file: topFrame ? topFrame.getFileName() : null,
      line: topFrame ? topFrame.getLineNumber() : null,
    });
  }

  let dataToSend = {
    api_key: sdkToken,
    project_id: apiKey,
    version: PAYLOAD_VERSION,
    sdk: "hono",
    data: {
      server: {
        timezone: CACHED_TIMEZONE,
        os: CACHED_OS_INFO,
        software: null,
        signature: null,
        protocol: protocol,
      },
      language: {
        name: "node",
        version: CACHED_NODE_VERSION,
      },
      request: {
        timestamp: getCachedTimestamp(),
        ip: getHonoClientIP(honoContext),
        url: getHonoRequestUrl(honoContext),
        user_agent: honoContext.req.header("user-agent"),
        method: honoContext.req.method,
        headers: maskSensitiveValues(
          getHonoHeaders(honoContext.req),
          fieldsToMaskMap
        ),
        body: maskedRequestPayload !== undefined ? maskedRequestPayload : null,
        route_path: getHonoRoutePath(honoContext),
      },
      response: {
        headers: maskSensitiveValues(
          getHonoResponseHeaders(honoContext.res),
          fieldsToMaskMap
        ),
        code: honoContext.res.status,
        size: responseBodySize,
        load_time: getRequestDuration(requestStartTime),
        body: maskedResponseBody !== undefined ? maskedResponseBody : null,
      },
      errors: errors,
      queries: Array.isArray(queries) ? queries : [],
    },
  };

  return dataToSend;
};

/**
 * Prepares the payload which is sent to Treblle.
 *
 * @param {object} Koa context object
 * @param {object} settings
 * @param {string} settings.sdkToken Treblle SDK token
 * @param {string} settings.apiKey Treblle API key
 * @param {number[]} settings.requestStartTime when the request started
 * @param {object} settings.fieldsToMaskMap map of fields to mask
 */
const generateKoaTrebllePayload = function (
  koaContext,
  { sdkToken, apiKey, requestStartTime, error, fieldsToMaskMap, queries, sdk = "koa" }
) {
  const payload =
    koaContext.request.method === "GET"
      ? koaContext.request.query
      : koaContext.request.body;
  const parsedPayload = getPayload(payload);
  const sizeCheckedPayload = checkPayloadSize(parsedPayload);
  const maskedRequestPayload = maskSensitiveValues(
    sizeCheckedPayload,
    fieldsToMaskMap
  );

  const responseHeaders = koaContext.response.headers;

  let errors = [];

  // We should be able to parse this, but you never know if users will try doing something weird...
  // TODO - figure out Koa buffers & streaming
  let maskedResponseBody;
  let parsedResponseBody;
  try {
    let originalResponseBody = koaContext.response.body;
    // if the response is streamed it could be a buffer
    // so we'll convert it to a string first
    if (Buffer.isBuffer(originalResponseBody)) {
      originalResponseBody = originalResponseBody.toString("utf8");
    }

    if (typeof originalResponseBody === "string") {
      parsedResponseBody = JSON.parse(originalResponseBody);
      const sizeCheckedResponseBody = checkPayloadSize(parsedResponseBody);
      maskedResponseBody = maskSensitiveValues(
        sizeCheckedResponseBody,
        fieldsToMaskMap
      );
    } else if (typeof originalResponseBody === "object") {
      const sizeCheckedResponseBody = checkPayloadSize(originalResponseBody);
      maskedResponseBody = maskSensitiveValues(
        sizeCheckedResponseBody,
        fieldsToMaskMap
      );
    }
  } catch {
    // if we can't parse the body we'll leave it empty and set an error
    errors.push({
      source: "onShutdown",
      type: "INVALID_JSON",
      message: "Invalid JSON format",
      file: null,
      line: null,
    });
  }

  const protocol = `${koaContext.request.protocol.toUpperCase()}/${
    koaContext.request.req.httpVersion
  }`;

  if (error) {
    const trace = stackTrace.parse(error);
    const topFrame = Array.isArray(trace) && trace.length > 0 ? trace[0] : null;

    errors.push({
      source: "onException",
      type: "UNHANDLED_EXCEPTION",
      message: error && error.message ? error.message : String(error),
      file: topFrame ? topFrame.getFileName() : null,
      line: topFrame ? topFrame.getLineNumber() : null,
    });
  }

  let dataToSend = {
    api_key: sdkToken,
    project_id: apiKey,
    version: PAYLOAD_VERSION,
    sdk: sdk,
    data: {
      server: {
        timezone: CACHED_TIMEZONE,
        os: CACHED_OS_INFO,
        software: null,
        signature: null,
        protocol: protocol,
      },
      language: {
        name: "node",
        version: CACHED_NODE_VERSION,
      },
      request: {
        timestamp: getCachedTimestamp(),
        ip: koaContext.request.ip,
        url: getRequestUrl(koaContext.request),
        user_agent: koaContext.request.header["user-agent"],
        method: koaContext.request.method,
        headers: maskSensitiveValues(
          koaContext.request.headers,
          fieldsToMaskMap
        ),
        body: maskedRequestPayload !== undefined ? maskedRequestPayload : null,
        route_path: getKoaRoutePath(koaContext),
      },
      response: {
        headers: maskSensitiveValues(responseHeaders, fieldsToMaskMap),
        code: koaContext.response.status,
        size: koaContext.response.length || null,
        load_time: getRequestDuration(requestStartTime),
        body: maskedResponseBody !== undefined ? maskedResponseBody : null,
      },
      errors: errors,
      queries: Array.isArray(queries) ? queries : [],
    },
  };

  return dataToSend;
};

function sendExpressPayloadToTreblle(
  req,
  res,
  { sdkToken, apiKey, requestStartTime, error, fieldsToMaskMap, debug, endpoint, queries, sdk = "express" }
) {
  let trebllePayload = generateTrebllePayload(req, res, {
    sdkToken,
    apiKey,
    requestStartTime,
    error,
    fieldsToMaskMap,
    queries,
    sdk,
  });

  sendPayloadToTreblleApi({ apiKey: sdkToken, trebllePayload, debug, endpoint });
}

function sendKoaPayloadToTreblle(
  koaContext,
  { sdkToken, apiKey, requestStartTime, fieldsToMaskMap, debug, error, endpoint, queries, sdk = "koa" }
) {
  let trebllePayload = generateKoaTrebllePayload(koaContext, {
    sdkToken,
    apiKey,
    requestStartTime,
    error,
    fieldsToMaskMap,
    queries,
    sdk,
  });

  sendPayloadToTreblleApi({ apiKey: sdkToken, trebllePayload, debug, endpoint });
}

async function sendHonoPayloadToTreblle(
  honoContext,
  { sdkToken, apiKey, requestStartTime, fieldsToMaskMap, debug, error, endpoint, queries }
) {
  let trebllePayload = generateHonoTrebllePayload(honoContext, {
    sdkToken,
    apiKey,
    requestStartTime,
    error,
    fieldsToMaskMap,
    queries,
  });
  return sendPayloadToTreblleApiAsync({
    apiKey: sdkToken,
    trebllePayload,
    debug,
    endpoint,
  });
}

function sendPayloadToTreblleApi({ apiKey, trebllePayload, debug, endpoint }) {
  sendPayloadToTreblleApiAsync({ apiKey, trebllePayload, debug, endpoint }).then(
    () => {},
    () => {}
  );
}
async function sendPayloadToTreblleApiAsync({ apiKey, trebllePayload, debug, endpoint }) {
  let f;
  let usingNodeFetch = false;
  // Check for global fetch first (Cloudflare Workers, modern Node.js)
  if (typeof fetch === "function") {
    f = fetch;
  }
  // Check for node-fetch (Node.js environments)
  else if (nodeFetch && typeof nodeFetch === "function") {
    f = nodeFetch;
    usingNodeFetch = true;
  } else if (nodeFetch && typeof nodeFetch.default === "function") {
    f = nodeFetch.default;
    usingNodeFetch = true;
  } else {
    if (debug) {
      console.warn("Treblle error: No fetch implementation available. Install node-fetch for Node.js environments.");
    }
    return;
  }

  // Add timeout and agent configuration
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

  const targetEndpoint = resolveEndpoint(endpoint);

  const { body, encoding } = await maybeGzipBody(JSON.stringify(trebllePayload));

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "Accept-Encoding": "gzip, deflate",
    Connection: "keep-alive",
    "User-Agent": `treblle-node/${VERSION}`,
  };
  if (encoding) {
    headers["Content-Encoding"] = encoding;
  }

  const fetchOptions = {
    method: "POST",
    headers,
    body,
    signal: controller.signal,
  };

  // The `agent` and `timeout` options are only honored by node-fetch. The
  // native/undici global fetch ignores them (and warns about unknown options),
  // so only attach them when we're actually using node-fetch. Native fetch
  // still gets its timeout enforced via the AbortController above.
  if (usingNodeFetch) {
    fetchOptions.agent = (url) => getAgent(url.protocol);
    fetchOptions.timeout = 5000;
  }

  try {
    const response = await f(targetEndpoint, fetchOptions);
    clearTimeout(timeoutId);
    if (debug && response.ok === false) {
      await logTreblleResponseError(response);
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

function logError(response, responseBody) {
  console.log(
    `[error] Sending data to Treblle failed - status: ${response.statusText} (${response.status})`,
    responseBody
  );
}

function logRequestFailed(error) {
  console.error(
    "[error] Sending data to Treblle failed (it's possibly a network error)",
    error
  );
}

/**
 * Creates a platform-aware start time for duration measurement
 * @returns {number[]|number} hrtime array for Node.js or timestamp for other platforms
 */
function createStartTime() {
  /// Use performance.now() if available
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now();
  }
  // Fallback to process.hrtime() if we're in Node.js environment and its available
  else if (typeof process !== 'undefined' && process.hrtime && typeof process.hrtime === 'function') {
    return process.hrtime();
  }
  // Last fallback to Date.now()
  else {
    return Date.now();
  }
}

/**
 * Calculates the request duration in milliseconds.
 *
 * @param {number[]|number} startTime
 * @returns {number} Duration in milliseconds
 */
function getRequestDuration(startTime) {
  // Handle Node.js hrtime format
  if (Array.isArray(startTime) && startTime.length === 2) {
    if (typeof process !== 'undefined' && process.hrtime && typeof process.hrtime === 'function') {
      const NS_PER_SEC = 1e9;
      const NS_TO_MS = 1e6;
      const diff = process.hrtime(startTime);
      const milliseconds = (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
      return Math.ceil(milliseconds);
    }
    // If we have hrtime format but no process.hrtime, return 0
    return 0;
  }
  
  // Handle performance.now() or Date.now() format (already in milliseconds)
  if (typeof startTime === 'number') {
    let endTime;
    if (typeof performance !== 'undefined' && performance.now) {
      endTime = performance.now();
    } else {
      endTime = Date.now();
    }
    // Return milliseconds
    return Math.ceil(endTime - startTime);
  }

  // Fallback: if we can't determine timing, return 0
  return 0;
}

function getRequestUrl(req) {
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  return fullUrl;
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
 * Extracts the route path pattern from Express/NestJS request
 * @param {object} req Express request object
 * @returns {string|null} Route pattern or null if not available
 */
function getRoutePath(req) {
  let routePath = null;

  // Express/NestJS route pattern
  if (req.route && req.route.path) {
    routePath = req.route.path;
  }
  // Fallback: try to get from baseUrl + route
  else if (req.baseUrl && req.route && req.route.path) {
    routePath = req.baseUrl + req.route.path;
  }

  // Transform Express :param syntax to OpenAPI {param} format
  if (routePath) {
    return transformToOpenAPIFormat(routePath);
  }

  return null;
}

/**
 * Extracts the route path pattern from Koa context
 * @param {object} ctx Koa context object
 * @returns {string|null} Route pattern or null if not available
 */
function getKoaRoutePath(ctx) {
  let routePath = null;

  // Koa Router path pattern
  if (ctx._matchedRoute) {
    routePath = ctx._matchedRoute;
  }
  // Alternative: check for matched routes array
  else if (ctx.matched && ctx.matched.length > 0) {
    const lastMatch = ctx.matched[ctx.matched.length - 1];
    if (lastMatch && lastMatch.path) {
      routePath = lastMatch.path;
    }
  }
  // Check for router layer path
  else if (ctx.routerPath) {
    routePath = ctx.routerPath;
  }

  // Transform Koa :param syntax to OpenAPI {param} format
  if (routePath) {
    return transformToOpenAPIFormat(routePath);
  }

  return null;
}

/**
 * Extracts the route path pattern from Hono context
 * @param {object} c Hono context object
 * @returns {string|null} Route pattern or null if not available
 */
function getHonoRoutePath(c) {
  let routePattern = null;

  try {
    // Fallback: Check deprecated routePath property in request (pre v4.8.0)
    if (c.req && c.req.routePath) {
      routePattern = c.req.routePath;
    }
    // Fallback: Check if context has routePath method
    else if (c.routePath && typeof c.routePath === "function") {
      routePattern = c.routePath();
    }
    // Fallback: Check if context has routePath as property
    else if (c.routePath && typeof c.routePath === "string") {
      routePattern = c.routePath;
    }
  } catch (error) {
    // If route helpers fail, continue without route pattern
    routePattern = null;
  }

  // Transform Hono :param syntax to OpenAPI {param} format
  if (routePattern) {
    return transformToOpenAPIFormat(routePattern);
  }

  return null;
}

/**
 * Gets client IP from Hono context
 * @param {object} c Hono context object
 * @returns {string|null} Client IP address
 */
function getHonoClientIP(c) {
  // Try to get IP from various Hono context sources
  return (
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    c.req.header("x-real-ip") ||
    c.req.header("cf-connecting-ip") ||
    c.env?.REMOTE_ADDR ||
    null
  );
}

/**
 * Gets request URL from Hono context
 * @param {object} c Hono context object
 * @returns {string} Request URL
 */
function getHonoRequestUrl(c) {
  return c.req.url;
}

/**
 * Gets headers from Hono request
 * @param {object} req Hono request object
 * @returns {object} Headers object
 */
function getHonoHeaders(req) {
  const headers = {};
  // Convert Headers object to plain object
  if (req.raw && req.raw.headers) {
    for (const [key, value] of req.raw.headers.entries()) {
      headers[key.toLowerCase()] = value;
    }
  }
  return headers;
}

/**
 * Gets headers from Hono response
 * @param {object} res Hono response object
 * @returns {object} Headers object
 */
function getHonoResponseHeaders(res) {
  const headers = {};
  // Convert Headers object to plain object
  if (res.headers) {
    for (const [key, value] of res.headers.entries()) {
      headers[key.toLowerCase()] = value;
    }
  }
  return headers;
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

module.exports = {
  sendExpressPayloadToTreblle,
  sendKoaPayloadToTreblle,
  sendHonoPayloadToTreblle,
  sendPayloadToTreblleApi,
  getPayloadSize,
  checkPayloadSize,
  getRandomEndpoint,
  resolveEndpoint,
  createStartTime,
  // Exported for unit testing
  maybeGzipBody,
  GZIP_MIN_BYTES,
  getRequestDuration,
  transformToOpenAPIFormat,
  getPayload,
  TREBLLE_ENDPOINT,
  TREBLLE_ENDPOINTS,
  MAX_PAYLOAD_SIZE,
};
