const { normalizeConfig } = require("../core/config");
const { captureAndSend } = require("../core/capture");
const { shouldTrack } = require("../core/blocklist");
const { createStartTime } = require("../core/timing");
const { redactInlineFiles } = require("../core/files");
const { createQueryStore, enterQueryContext } = require("../queryTracking");

/**
 * Registers the Treblle hooks on a Fastify instance.
 *
 * Unlike the Koa/Hono adapters, Fastify has no single `next()` boundary that
 * wraps the route handler, so tracking is spread across four lifecycle hooks:
 *   - `onRequest`  — mark the start time and open the query-tracking context
 *   - `onSend`     — capture the (already serialized) response body
 *   - `onError`    — stash a thrown error for the payload
 *   - `onResponse` — build the snapshot and fire the payload once the response
 *                    has been fully sent (off the request's critical path)
 *
 * Call this on the root instance before your routes are registered, so the
 * hooks apply to every route (Fastify hooks added to an instance apply to that
 * instance and everything registered after it).
 *
 * @param {object} fastify Fastify instance
 * @param {object} settings see core/config.js for the shared options
 * @returns {object} the same Fastify instance
 */
function useFastifyTreblle(fastify, settings) {
  return installTreblle(fastify, normalizeConfig(settings, { sdk: "fastify" }));
}

/**
 * Registers Treblle on a NestJS app running on the Fastify platform adapter.
 * Pass the underlying Fastify instance, e.g.
 * `app.getHttpAdapter().getInstance()`.
 *
 * @param {object} fastify Fastify instance (NestJS's underlying HTTP adapter)
 * @param {object} settings see core/config.js for the shared options
 * @returns {object} the same Fastify instance
 */
function useNestFastifyTreblle(fastify, settings) {
  return installTreblle(fastify, normalizeConfig(settings, { sdk: "nest" }));
}

function installTreblle(fastify, config) {
  fastify.addHook("onRequest", function (request, _reply, done) {
    try {
      // Decide once, up front, whether this request is tracked at all so the
      // remaining hooks can cheaply bail out.
      if (!shouldTrack(config, request.url)) {
        request._treblleSkip = true;
        return done();
      }

      request._treblleStartTime = createStartTime();

      // Open a per-request query store and make it the active context. Fastify
      // keeps a single async context from here through the handler, so
      // `trackQuery` calls made in the handler land in this store.
      const queryStore = createQueryStore();
      request._treblleQueryStore = queryStore;
      enterQueryContext(queryStore);
    } catch (err) {
      if (config.debug) {
        console.error("Treblle onRequest hook failed:", err);
      }
    }
    done();
  });

  fastify.addHook("onSend", function (request, _reply, payload, done) {
    try {
      if (!request._treblleSkip) {
        // `payload` is the serialized body. Strings and Buffers are handled by
        // the shared payload pipeline; streams (and anything else) are left
        // uncaptured rather than consumed.
        if (typeof payload === "string" || Buffer.isBuffer(payload)) {
          request._treblleResponseBody = payload;
        }
      }
    } catch (err) {
      if (config.debug) {
        console.error("Treblle onSend hook failed:", err);
      }
    }
    // Must return the (unmodified) payload so the response is sent as-is.
    done(null, payload);
  });

  fastify.addHook("onError", function (request, _reply, error, done) {
    // Stash the error; the onResponse hook attaches it to the single payload.
    request._treblleError = error;
    done();
  });

  fastify.addHook("onResponse", function (request, reply, done) {
    try {
      if (!request._treblleSkip) {
        captureAndSend(
          config,
          buildFastifySnapshot(request, reply, {
            requestStartTime: request._treblleStartTime,
            error: request._treblleError,
            queries: request._treblleQueryStore
              ? request._treblleQueryStore.queries
              : [],
            metadata: request._treblleQueryStore
              ? request._treblleQueryStore.metadata
              : {},
          }),
        );
      }
    } catch (err) {
      if (config.debug) {
        console.error("Treblle onResponse hook failed:", err);
      }
    }
    done();
  });

  return fastify;
}

/**
 * Builds the normalized snapshot for a Fastify request/reply pair.
 * See core/payload.js for the snapshot contract.
 */
function buildFastifySnapshot(
  request,
  reply,
  { requestStartTime, error, queries, metadata },
) {
  const protocol = request.protocol || "http";
  const httpVersion = request.raw && request.raw.httpVersion;

  return {
    protocol: `${protocol.toUpperCase()}/${httpVersion || "1.1"}`,
    request: {
      ip: request.ip,
      url: `${protocol}://${request.hostname}${request.url}`,
      userAgent: request.headers["user-agent"],
      method: request.method,
      headers: request.headers,
      // With @fastify/multipart's `attachFieldsToBody`, uploaded files sit inline
      // on request.body; swap them for descriptors. (In the default streaming
      // mode the file is consumed as a stream in the handler and isn't on the
      // request here, so there's nothing to capture.)
      body:
        request.method === "GET"
          ? request.query
          : redactInlineFiles(request.body),
      routePath: getFastifyRoutePath(request),
    },
    response: {
      statusCode: reply.statusCode,
      headers: reply.getHeaders(),
      body: request._treblleResponseBody,
      size: getResponseSize(reply, request._treblleResponseBody),
    },
    error,
    queries,
    metadata,
    startTime: requestStartTime,
  };
}

/**
 * Extracts the raw route path pattern (e.g. "/users/:id") from a Fastify
 * request, across the v4/v5 API changes.
 * @param {object} request Fastify request object
 * @returns {string|null} Route pattern or null if not available
 */
function getFastifyRoutePath(request) {
  // Fastify v4.10+/v5: route metadata lives under routeOptions.
  if (request.routeOptions && request.routeOptions.url) {
    return request.routeOptions.url;
  }
  // Older Fastify exposed the pattern directly on the request.
  if (request.routerPath) {
    return request.routerPath;
  }
  return null;
}

/**
 * Resolves the response size, preferring the Content-Length header and falling
 * back to the byte length of the captured body.
 * @param {object} reply Fastify reply object
 * @param {(string|Buffer|undefined)} body captured response body
 * @returns {number|null}
 */
function getResponseSize(reply, body) {
  const contentLength = reply.getHeader("content-length");
  if (contentLength != null) {
    const size =
      typeof contentLength === "number"
        ? contentLength
        : parseInt(contentLength, 10);
    if (Number.isFinite(size)) {
      return size;
    }
  }
  if (typeof body === "string") {
    return Buffer.byteLength(body);
  }
  if (Buffer.isBuffer(body)) {
    return body.length;
  }
  return null;
}

module.exports = {
  useFastifyTreblle,
  useNestFastifyTreblle,
  // Exported for unit testing
  buildFastifySnapshot,
};
