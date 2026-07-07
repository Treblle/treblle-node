const { normalizeConfig } = require("../core/config");
const { captureAndSendAsync } = require("../core/capture");
const { shouldTrack } = require("../core/blocklist");
const { createStartTime } = require("../core/timing");
const { redactInlineFiles } = require("../core/files");
const { createQueryStore, runWithQueryContext } = require("../queryTracking");

/**
 * Treblle middleware for Hono.
 *
 * @param {object} settings see core/config.js for the shared options
 * @returns {function} hono middleware function
 */
function honoTreblle(settings) {
  const config = normalizeConfig(settings, { sdk: "hono" });

  return async function (c, next) {
    // Check if the request path is blocked
    if (!shouldTrack(config, c.req.url)) {
      return next();
    }

    return honoMiddlewareFn(config, c, next);
  };
}

async function honoMiddlewareFn(config, c, next) {
  const requestStartTime = createStartTime();
  const queryStore = createQueryStore();
  // On runtimes with an execution context (e.g. edge platforms) the send must
  // be kept alive past the response; elsewhere it's fire-and-forget.
  // Hono exposes `executionCtx` as a getter that throws when the runtime has no
  // execution context (e.g. @hono/node-server), so `"executionCtx" in c` isn't
  // enough — the access itself must be guarded.
  let wrapper = (p) => p.catch(() => {});
  try {
    if (c.executionCtx) {
      wrapper = c.executionCtx.waitUntil.bind(c.executionCtx);
    }
  } catch {
    // No execution context on this runtime — keep the fire-and-forget wrapper.
  }

  // Run the handler, remembering any error it throws so the single task we
  // schedule below carries it. The error is re-thrown afterwards so Hono's own
  // error handling still runs.
  let caughtError;
  try {
    await runWithQueryContext(queryStore, () => next());
  } catch (error) {
    caughtError = error;
  }

  wrapper(
    honoTask(config, c, {
      requestStartTime,
      error: caughtError,
      queries: queryStore.queries,
      metadata: queryStore.metadata,
    }),
  );

  if (caughtError) throw caughtError;
}

async function honoTask(
  config,
  c,
  { requestStartTime, error, queries, metadata },
) {
  try {
    await captureHonoRequestBody(c);
    await captureHonoResponseBody(c);
  } finally {
    await captureAndSendAsync(
      config,
      buildHonoSnapshot(c, { requestStartTime, error, queries, metadata }),
    );
  }
}

async function captureHonoRequestBody(c) {
  try {
    if (c.req?.method !== "GET") {
      const contentType = c.req.header("content-type") || "";
      let requestBody = null;

      // Read the body exactly once, based on the content type. Reading it
      // more than once can consume the underlying stream and lose data.
      try {
        if (contentType.includes("application/json")) {
          requestBody = await c.req.json();
        } else if (
          contentType.includes("form-urlencoded") ||
          contentType.includes("multipart/form-data")
        ) {
          requestBody = await c.req.parseBody();
        } else {
          requestBody = await c.req.text();
        }
      } catch {
        requestBody = null;
      }

      // Store captured body for later access
      c.__treblle_body_request = requestBody;
    }
  } catch (error) {
    // If capture fails, continue without body data
    c.__treblle_body_request = null;
  }
}

async function captureHonoResponseBody(c) {
  try {
    if (c.res && c.res.body) {
      // Clone the response to read the body without consuming it
      const clonedResponse = c.res.clone();

      let responseBody, responseBodySize;
      if (clonedResponse.headers.has("content-length")) {
        responseBodySize = parseInt(
          clonedResponse.headers.get("content-length"),
        );
      }
      try {
        const buffer = await clonedResponse.arrayBuffer();
        responseBody = new TextDecoder().decode(buffer);
        if (!responseBodySize) {
          responseBodySize = buffer.byteLength;
        }
      } catch {
        // If all fails, leave it null
        responseBodySize = null;
        responseBody = null;
      }

      // Store captured body for later access
      c.__treblle_body_response = responseBody;
      c.__treblle_body_response_size = responseBodySize;
    }
  } catch (error) {
    // If capture fails, continue without body data
    c.__treblle_body_response = null;
    c.__treblle_body_response_size = null;
  }
}

/**
 * Builds the normalized snapshot for a Hono context. Request/response bodies
 * are pre-captured onto the context by the middleware (read-once streams).
 * See core/payload.js for the snapshot contract.
 */
function buildHonoSnapshot(c, { requestStartTime, error, queries, metadata }) {
  return {
    // Hono doesn't expose the negotiated HTTP version
    protocol: "HTTP/1.1",
    request: {
      ip: getHonoClientIP(c),
      url: c.req.url,
      userAgent: c.req.header("user-agent"),
      method: c.req.method,
      headers: getHonoHeaders(c.req),
      // parseBody() returns uploaded files as inline File objects; swap them for
      // name/type/size descriptors so the raw bytes are never shipped.
      body:
        c.req.method === "GET"
          ? c.req.queries()
          : redactInlineFiles(c.__treblle_body_request),
      routePath: getHonoRoutePath(c),
    },
    response: {
      statusCode: c.res.status,
      headers: getHonoResponseHeaders(c.res),
      body: c.__treblle_body_response,
      size: c.__treblle_body_response_size || null,
    },
    error,
    queries,
    metadata,
    startTime: requestStartTime,
  };
}

/**
 * Extracts the raw route path pattern from Hono context
 * @param {object} c Hono context object
 * @returns {string|null} Route pattern or null if not available
 */
function getHonoRoutePath(c) {
  try {
    // Route pattern lives on the request across the Hono 4.x line.
    if (c.req && c.req.routePath) {
      return c.req.routePath;
    }
    // Some versions expose it on the context instead, as a method or a string.
    if (c.routePath && typeof c.routePath === "function") {
      return c.routePath();
    }
    if (c.routePath && typeof c.routePath === "string") {
      return c.routePath;
    }
  } catch (error) {
    // If route helpers fail, continue without route pattern
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
 * Converts a web-standard Headers object into a plain object with lower-cased
 * keys. Returns an empty object when there are no headers.
 * @param {Headers|undefined|null} headers
 * @returns {object} Headers object
 */
function headersToObject(headers) {
  const out = {};
  if (headers) {
    for (const [key, value] of headers.entries()) {
      out[key.toLowerCase()] = value;
    }
  }
  return out;
}

/**
 * Gets headers from Hono request
 * @param {object} req Hono request object
 * @returns {object} Headers object
 */
function getHonoHeaders(req) {
  return headersToObject(req.raw && req.raw.headers);
}

/**
 * Gets headers from Hono response
 * @param {object} res Hono response object
 * @returns {object} Headers object
 */
function getHonoResponseHeaders(res) {
  return headersToObject(res.headers);
}

module.exports = {
  honoTreblle,
  // Exported for unit testing
  buildHonoSnapshot,
};
