const { normalizeConfig } = require("../core/config");
const { captureAndSend } = require("../core/capture");
const { shouldTrack } = require("../core/blocklist");
const { createStartTime } = require("../core/timing");
const { applyFileDescriptors } = require("../core/files");
const { createQueryStore, runWithQueryContext } = require("../queryTracking");

/**
 * Adds the Treblle middleware to the app.
 *
 * @param {object} app Express app
 * @param {object} settings see core/config.js for the shared options
 * @returns {object} updated Express app
 */
const useTreblle = function (app, settings) {
  return installTreblle(app, normalizeConfig(settings, { sdk: "express" }));
};

/**
 * Adds the Treblle middleware to a NestJS app running on the Express adapter.
 *
 * @param {object} app Express app (NestJS's underlying HTTP adapter instance)
 * @param {object} settings see core/config.js for the shared options
 * @returns {object} updated Express app
 */
const useNestTreblle = function (app, settings) {
  return installTreblle(app, normalizeConfig(settings, { sdk: "nest" }));
};

function installTreblle(app, config) {
  // Use standard middleware approach instead of patching
  app.use(TreblleMiddleware(config));

  // Add error handling middleware at the END of the stack (see helper).
  registerErrorMiddleware(app, config);

  return app;
}

/**
 * Registers the Treblle error-recording middleware at the tail of the app's
 * middleware stack.
 *
 * Express only forwards errors to error-handling middleware declared *after*
 * the handler that threw. Since `useTreblle`/`useNestTreblle` are typically
 * called before the app's routes are defined, registering the error middleware
 * inline would place it ahead of every route, making it unreachable via
 * `next(err)`. Deferring registration with `setImmediate` lets the synchronous
 * route/middleware setup finish first, so the recorder lands last in the stack
 * and is reached when a route errors — while still being in place before any
 * request is handled.
 *
 * @param {object} app Express app
 * @param {object} config normalized config
 */
function registerErrorMiddleware(app, { debug }) {
  const register = () => {
    try {
      app.use(TreblleErrorMiddleware({ debug }));
    } catch (err) {
      if (debug) {
        console.error("Treblle failed to register error middleware:", err);
      }
    }
  };

  if (typeof setImmediate === "function") {
    setImmediate(register);
  } else {
    register();
  }
}

/**
 * Error handling middleware for Treblle.
 *
 * This records the error on the request so the tracking middleware's "finish"
 * handler can attach it to the single payload it already sends for the request.
 * Recording (rather than sending here) avoids emitting a duplicate payload,
 * since the response's "finish" event fires regardless of the error.
 *
 * @param {object} settings
 * @param {boolean} settings.debug controls error logging
 * @returns {function} Express error middleware
 */
function TreblleErrorMiddleware({ debug }) {
  return function _TreblleErrorMiddleware(err, req, res, next) {
    try {
      // Stash the error; the "finish" handler in TreblleMiddleware picks it up.
      req._treblleError = err;
    } catch (treblleError) {
      if (debug) {
        console.error("Treblle error middleware failed:", treblleError);
      }
    }

    // Always call next to pass the error to the next error handler
    next(err);
  };
}

function TreblleMiddleware(config) {
  return function _TreblleMiddlewareHandler(req, res, next) {
    // Per-request store for tracked SQL queries. Held in the closure so the
    // "finish" handler (which runs outside the ALS context) can still read it.
    const queryStore = createQueryStore();

    try {
      const requestStartTime = createStartTime();
      req._treblleStartTime = requestStartTime;

      // Non-invasive response body capture using response event listeners
      captureResponseBody(res);

      res.on("finish", function () {
        // Check if the request path is blocked
        if (shouldTrack(config, req.path)) {
          captureAndSend(
            config,
            buildExpressSnapshot(req, res, {
              requestStartTime,
              // Set by TreblleErrorMiddleware when a downstream route throws.
              error: req._treblleError,
              queries: queryStore.queries,
              metadata: queryStore.metadata,
            }),
          );
        }
      });
    } catch (err) {
      if (config.debug) {
        console.error("Treblle middleware error:", err);
      }
      next && next();
      return;
    }

    // Run the rest of the request within the query-tracking context so
    // `trackQuery` calls made by downstream handlers land in `queryStore`.
    if (next) {
      runWithQueryContext(queryStore, () => next());
    }
  };
}

/**
 * Non-invasive response body capture that works with both Express v4 and v5
 * @param {object} res Express response object
 */
function captureResponseBody(res) {
  const originalSend = res.send;
  const originalJson = res.json;
  const originalEnd = res.end;

  // Override send method
  res.send = function (body) {
    res.__treblle_body_response = body;
    return originalSend.call(this, body);
  };

  // Override json method
  res.json = function (obj) {
    res.__treblle_body_response = obj;
    return originalJson.call(this, obj);
  };

  // Override end method as fallback. Node's signature is
  // `res.end([data[, encoding]][, callback])`, so forward every argument
  // untouched and only capture the first when it's an actual body (a string or
  // Buffer) — never a callback passed as `res.end(cb)`.
  res.end = function (...args) {
    const chunk = args[0];
    if (
      (typeof chunk === "string" || Buffer.isBuffer(chunk)) &&
      !res.__treblle_body_response
    ) {
      res.__treblle_body_response = chunk;
    }
    return originalEnd.apply(this, args);
  };
}

/**
 * Builds the normalized snapshot for an Express/NestJS request-response pair.
 * See core/payload.js for the snapshot contract.
 */
function buildExpressSnapshot(
  req,
  res,
  { requestStartTime, error, queries, metadata },
) {
  const responseBody = res.__treblle_body_response;
  // get rid of the workaround body, we don't need it anymore
  delete res.__treblle_body_response;

  return {
    protocol: `${req.protocol.toUpperCase()}/${req.httpVersion}`,
    request: {
      ip: req.ip,
      url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      userAgent: req.get("user-agent"),
      method: req.method,
      headers: req.headers,
      // multer keeps uploaded files off req.body (in req.file/req.files); fold
      // in file descriptors so uploads show up without shipping the raw bytes.
      body:
        req.method === "GET"
          ? req.query
          : applyFileDescriptors(req.body, req.files || req.file),
      routePath: getRoutePath(req),
    },
    response: {
      statusCode: res.statusCode,
      headers: res.getHeaders(),
      body: responseBody,
      size: res._contentLength,
    },
    error,
    queries,
    metadata,
    startTime: requestStartTime,
  };
}

/**
 * Extracts the raw route path pattern from Express/NestJS request
 * @param {object} req Express request object
 * @returns {string|null} Route pattern or null if not available
 */
function getRoutePath(req) {
  // Express/NestJS route pattern
  if (req.route && req.route.path) {
    return req.route.path;
  }
  return null;
}

module.exports = {
  useTreblle,
  useNestTreblle,
  // Exported for unit testing
  buildExpressSnapshot,
};
