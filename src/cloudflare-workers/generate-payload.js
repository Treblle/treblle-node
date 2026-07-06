const stackTrace = require("stack-trace");

const version = require("../../package.json").version;
const { maskSensitiveValues } = require("../maskFields");
const { checkPayloadSize } = require("../sender");
const { ContentType } = require("../consts");

// Cache expensive operations at module load (same as sender.js)
const CACHED_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

async function generatePayload(
  request,
  response,
  { sdkToken, apiKey, fieldsToMaskMap, requestExecutionTime, error }
) {
  const errors = [];

  const requestBody = await parseRequest(request);
  const sizeCheckedRequestBody = requestBody
    ? checkPayloadSize(requestBody)
    : null;
  const maskedRequestBody = sizeCheckedRequestBody
    ? maskSensitiveValues(sizeCheckedRequestBody, fieldsToMaskMap)
    : null;

  let maskedResponseBody = null;
  try {
    const responseBody = response ? await parseResponse(response) : null;
    const sizeCheckedResponseBody = responseBody
      ? checkPayloadSize(responseBody)
      : null;
    maskedResponseBody = sizeCheckedResponseBody
      ? maskSensitiveValues(sizeCheckedResponseBody, fieldsToMaskMap)
      : null;
  } catch (err) {
    errors.push({
      source: "onShutdown",
      type: "INVALID_JSON",
      message: "Response in invalid JSON format",
      file: null,
      line: null,
    });
  }

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

  const requestHeaders = maskSensitiveValues(
    parseHeaders(request && request.headers),
    fieldsToMaskMap
  );
  const responseHeaders = maskSensitiveValues(
    parseHeaders(response && response.headers),
    fieldsToMaskMap
  );

  return {
    api_key: sdkToken,
    project_id: apiKey,
    version: version,
    sdk: "cloudflare",
    data: {
      server: {
        timezone: CACHED_TIMEZONE,
        os: {
          name: "Cloudflare Workers Runtime",
        },
        software: null,
        signature: null,
        protocol: request.cf.httpProtocol,
      },
      language: {
        name: "js",
      },
      request: {
        timestamp: getCachedTimestamp(),
        ip: request.headers.get("x-real-ip"),
        url: request.url,
        user_agent: request.headers.get("user-agent"),
        method: request.method,
        headers: requestHeaders,
        body: maskedRequestBody ? maskedRequestBody : null,
        route_path: getCloudflareRoutePath(request),
      },
      response: {
        headers: response ? responseHeaders : null,
        code: response ? response.status : 500,
        size: response ? getSize(maskedResponseBody) : 0,
        load_time:
          requestExecutionTime > 0 ? requestExecutionTime * 1000 : 1000,
        body: maskedResponseBody ? maskedResponseBody : null,
      },
      errors: errors,
    },
  };
}

const parseRequest = async (request) => {
  const requestContentType = request.headers.get("content-type");

  if (request.method === "GET") {
    const requestBody = {};
    for (let pair of new URL(request.url).searchParams.entries()) {
      requestBody[pair[0]] = pair[1];
    }
    return requestBody;
  } else if (
    requestContentType.includes(ContentType.MultipartFormData) ||
    requestContentType.includes(ContentType.ApplicationFormData)
  ) {
    const requestBody = {};
    const body = await request.formData();
    for (let pair of body.entries()) {
      requestBody[pair[0]] = pair[1];
    }
    return requestBody;
  } else if (requestContentType.includes(ContentType.Text)) {
    return request.text();
  } else if (requestContentType.includes(ContentType.Json)) {
    return request.json();
  } else {
    return null;
  }
};

const parseResponse = async (response) => {
  const responseContentType = response.headers.get("content-type");
  if (responseContentType.includes(ContentType.Text)) {
    return response.text();
  } else if (responseContentType.includes(ContentType.Json)) {
    return response.json();
  } else {
    const content = await response.text();
    if (content && content.length > 0) {
      try {
        return JSON.parse(content);
      } catch (e) {
        return content;
      }
    }
    return null;
  }
};

const parseHeaders = (headers) => {
  if (!headers) {
    return null;
  }
  const hdrs = {};
  for (let pair of headers.entries()) {
    hdrs[pair[0]] = pair[1];
  }
  return hdrs;
};

const getSize = (item) => {
  if (!item) {
    return 0;
  } else if (typeof item === "string") {
    return item.length;
  } else if (typeof item === "object") {
    return JSON.stringify(item).length;
  } else {
    return 0;
  }
};

/**
 * Extracts route path from Cloudflare Workers request
 * Since Cloudflare Workers don't have built-in routing,
 * this checks for a custom route_path property set by the developer
 * @param {Request} request Cloudflare Workers request object
 * @returns {string|null} Route pattern or null if not available
 */
const getCloudflareRoutePath = (request) => {
  // Check if developer has set a custom route_path property
  if (request.route_path) {
    return request.route_path;
  }

  // Check if it's in the request headers (custom implementation)
  const routeHeader = request.headers.get("x-route-path");
  if (routeHeader) {
    return routeHeader;
  }

  return null;
};

module.exports = {
  generatePayload,
};
