const { maskSensitiveValues } = require("./maskFields");
const os = require("os");
const fetch = require("node-fetch");
const stackTrace = require("stack-trace");
const VERSION = require("../package.json").version;
const http = require("http");
const https = require("https");

// Cache expensive operations at module load
const CACHED_OS_INFO = {
  name: os.platform(),
  release: os.release(),
  architecture: os.arch(),
};
const CACHED_NODE_VERSION = process.version;
const CACHED_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// HTTP Agent with connection pooling and keep-alive
const HTTP_AGENT = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000, // 30 seconds
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 5000, // 5 second socket timeout
});

const HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 5000,
});

// Treblle API endpoints for load balancing
const TREBLLE_ENDPOINTS = [
  "https://rocknrolla.treblle.com",
  "https://sicario.treblle.com",
  "https://punisher.treblle.com",
];

function getRandomEndpoint() {
  const randomIndex = Math.floor(Math.random() * TREBLLE_ENDPOINTS.length);
  return TREBLLE_ENDPOINTS[randomIndex];
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
 * @param {string} settings.apiKey Treblle API Key
 * @param {string} settings.projectId Treblle Project ID
 * @param {number[]} settings.requestStartTime when the request started
 * @param {object} settings.fieldsToMaskMap map of fields to mask
 */
const generateTrebllePayload = function (
  req,
  res,
  { apiKey, projectId, requestStartTime, error, fieldsToMaskMap }
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

    errors.push({
      source: "onException",
      type: "UNHANDLED_EXCEPTION",
      message: error.message,
      file: trace[0].getFileName(),
      line: trace[0].getLineNumber(),
    });
  }

  let dataToSend = {
    api_key: apiKey,
    project_id: projectId,
    version: VERSION,
    sdk: "node",
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
    },
  };

  return dataToSend;
};

/**
 * Prepares the payload which is sent to Treblle.
 *
 * @param {object} Koa context object
 * @param {object} settings
 * @param {string} settings.apiKey Treblle API Key
 * @param {string} settings.projectId Treblle Project ID
 * @param {number[]} settings.requestStartTime when the request started
 * @param {object} settings.fieldsToMaskMap map of fields to mask
 */
const generateKoaTrebllePayload = function (
  koaContext,
  { apiKey, projectId, requestStartTime, error, fieldsToMaskMap }
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

    errors.push({
      source: "onException",
      type: "UNHANDLED_EXCEPTION",
      message: error.message,
      file: trace[0].getFileName(),
      line: trace[0].getLineNumber(),
    });
  }

  let dataToSend = {
    api_key: apiKey,
    project_id: projectId,
    version: VERSION,
    sdk: "node",
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
    },
  };

  return dataToSend;
};

function sendExpressPayloadToTreblle(
  req,
  res,
  { apiKey, projectId, requestStartTime, error, fieldsToMaskMap, showErrors }
) {
  let trebllePayload = generateTrebllePayload(req, res, {
    apiKey,
    projectId,
    requestStartTime,
    error,
    fieldsToMaskMap,
  });

  sendPayloadToTreblleApi({ apiKey, trebllePayload, showErrors });
}

function sendKoaPayloadToTreblle(
  koaContext,
  { apiKey, projectId, requestStartTime, fieldsToMaskMap, showErrors, error }
) {
  let trebllePayload = generateKoaTrebllePayload(koaContext, {
    apiKey,
    projectId,
    requestStartTime,
    error,
    fieldsToMaskMap,
  });

  sendPayloadToTreblleApi({ apiKey, trebllePayload, showErrors });
}

function sendPayloadToTreblleApi({ apiKey, trebllePayload, showErrors }) {
  let f;
  if (typeof fetch === "function") {
    f = fetch;
  } else if (fetch && typeof fetch.default === "function") {
    f = fetch.default;
  } else {
    if (showErrors) {
      console.warn("Treblle error: fetch is not defined");
    }
    return;
  }

  // Add timeout and agent configuration
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

  const endpoint = getRandomEndpoint();

  f(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "Accept-Encoding": "gzip, deflate",
      Connection: "keep-alive",
      "User-Agent": `treblle-node/${VERSION}`,
    },
    body: JSON.stringify(trebllePayload),
    agent: (url) => (url.protocol === "https:" ? HTTPS_AGENT : HTTP_AGENT),
    timeout: 5000,
    signal: controller.signal,
  }).then(
    (response) => {
      clearTimeout(timeoutId);
      if (showErrors && response.ok === false) {
        logTreblleResponseError(response);
      }
    },
    (error) => {
      clearTimeout(timeoutId);
      if (showErrors) {
        logRequestFailed(error);
      }
    }
  );
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
 * Calculates the request duration.
 *
 * @param {number[]} startTime
 * @returns {number}
 */
function getRequestDuration(startTime) {
  const NS_PER_SEC = 1e9;
  const NS_TO_MICRO = 1e3;
  const diff = process.hrtime(startTime);

  const microseconds = (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MICRO;

  return Math.ceil(microseconds);
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
  sendPayloadToTreblleApi,
  getPayloadSize,
  checkPayloadSize,
  getRandomEndpoint,
};
