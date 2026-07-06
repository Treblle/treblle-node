const { generateFieldsToMaskMap } = require("./maskFields");
const {
  sendExpressPayloadToTreblle,
  sendKoaPayloadToTreblle,
  sendHonoPayloadToTreblle,
  createStartTime,
} = require("./sender");
const { DefaultBlockedPatterns } = require("./consts");
const { createQueryStore, runWithQueryContext } = require("./queryTracking");

/**
 * Normalizes a URL or path down to just its pathname, stripping any query
 * string or hash. Handles both absolute URLs (e.g. Hono's `c.req.url`) and
 * plain paths (e.g. Koa's `ctx.request.url`) so blocklist matching is
 * consistent across frameworks and anchored regexes still match.
 * @param {string} urlOrPath
 * @returns {string}
 */
function extractPathname(urlOrPath) {
  if (typeof urlOrPath !== "string") return urlOrPath;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrPath)) {
    try {
      return new URL(urlOrPath).pathname;
    } catch {
      // fall through to manual stripping
    }
  }

  const queryIndex = urlOrPath.search(/[?#]/);
  return queryIndex === -1 ? urlOrPath : urlOrPath.slice(0, queryIndex);
}

/**
 * Checks if a request path should be blocked from Treblle tracking
 * @param {string} path - The request path to check
 * @param {(string[]|RegExp|null)} userBlocklistPaths - User-defined blocked paths
 * @param {boolean} ignoreDefaults - Whether to ignore default blocked patterns
 * @returns {boolean} - True if the path should be blocked
 */
function isPathBlocked(path, userBlocklistPaths = [], ignoreDefaults = false) {
  // Check user-defined blocklist first
  if (userBlocklistPaths) {
    if (userBlocklistPaths instanceof RegExp) {
      if (userBlocklistPaths.test(path)) return true;
    } else if (Array.isArray(userBlocklistPaths)) {
      const isUserBlocked = userBlocklistPaths.some((blockedPath) => {
        if (typeof blockedPath === 'string') {
          return path.startsWith(`/${blockedPath}`) || path === `/${blockedPath}` || path === blockedPath;
        }
        if (blockedPath instanceof RegExp) {
          return blockedPath.test(path);
        }
        return false;
      });
      if (isUserBlocked) return true;
    }
  }

  // Check default blocked patterns (unless explicitly ignored)
  if (!ignoreDefaults) {
    const isDefaultBlocked = DefaultBlockedPatterns.some(pattern => pattern.test(path));
    if (isDefaultBlocked) return true;
  }

  return false;
}

/**
 * Adds the Treblle middleware to the app.
 *
 * @param {object} app Express app
 * @param {object} settings
 * @param {string} settings.sdkToken Treblle SDK token
 * @param {string} settings.apiKey Treblle API key
 * @param {string[]?} settings.additionalFieldsToMask specify additional fields to hide
 * @param {(string[]|RegExp)?} settings.blocklistPaths specify additional paths to hide
 * @param {boolean?} settings.ignoreDefaultBlockedPaths ignore default blocked paths (favicon.ico, robots.txt, etc.)
 * @param {boolean?} settings.debug controls error logging when sending data to Treblle
 * @param {string?} settings.endpoint custom Treblle ingress endpoint (e.g. "https://ingress-eu.treblle.com")
 * @returns {object} updated Express app
 */
const useTreblle = function (
  app,
  {
    sdkToken,
    apiKey,
    additionalFieldsToMask,
    blocklistPaths = [],
    ignoreDefaultBlockedPaths = false,
    debug = false,
    endpoint,
  }
) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);

  // Use standard middleware approach instead of patching
  app.use(
    TreblleMiddleware({
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      blocklistPaths,
      ignoreDefaultBlockedPaths,
      debug,
      endpoint,
    })
  );

  // Add error handling middleware at the END of the stack (see helper).
  registerErrorMiddleware(app, { debug });

  return app;
};

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
 * @param {object} settings
 * @param {boolean} settings.debug
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
 * Adds the Treblle middleware to the app.
 *
 * @param {object} app Express app
 * @param {object} settings
 * @param {string} settings.sdkToken Treblle SDK token
 * @param {string} settings.apiKey Treblle API key
 * @param {string[]?} settings.additionalFieldsToMask specify additional fields to hide
 * @param {(string[]|RegExp)?} settings.blocklistPaths specify additional paths to hide
 * @param {boolean?} settings.ignoreDefaultBlockedPaths ignore default blocked paths (favicon.ico, robots.txt, etc.)
 * @param {boolean?} settings.debug controls error logging when sending data to Treblle
 * @param {string?} settings.endpoint custom Treblle ingress endpoint (e.g. "https://ingress-eu.treblle.com")
 * @returns {object} updated Express app
 */
const useNestTreblle = function (
  app,
  {
    sdkToken,
    apiKey,
    additionalFieldsToMask,
    blocklistPaths = [],
    ignoreDefaultBlockedPaths = false,
    debug = false,
    endpoint,
  }
) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);

  // Use standard middleware approach instead of patching
  app.use(
    TreblleMiddleware({
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      blocklistPaths,
      ignoreDefaultBlockedPaths,
      debug,
      endpoint,
      isNestjs: true,
    })
  );

  // Add error handling middleware at the END of the stack (see helper).
  registerErrorMiddleware(app, { debug });

  return app;
};

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

function TreblleMiddleware({
  sdkToken,
  apiKey,
  fieldsToMaskMap,
  blocklistPaths,
  ignoreDefaultBlockedPaths,
  debug,
  endpoint,
  isNestjs,
}) {
  return function _TreblleMiddlewareHandler(req, res, next) {
    // Per-request store for tracked SQL queries. Held in the closure so the
    // "finish" handler (which runs outside the ALS context) can still read it.
    const queryStore = createQueryStore();

    try {
      const requestStartTime = process.hrtime();
      req._treblleStartTime = requestStartTime;

      // Non-invasive response body capture using response event listeners
      captureResponseBody(res);

      res.on("finish", function () {
        // Check if the request path is blocked
        const pathBlocked = isPathBlocked(req.path, blocklistPaths, ignoreDefaultBlockedPaths);

        if (!pathBlocked) {
          sendExpressPayloadToTreblle(req, res, {
            sdkToken,
            apiKey,
            requestStartTime,
            fieldsToMaskMap,
            debug,
            endpoint,
            // Set by TreblleErrorMiddleware when a downstream route throws.
            error: req._treblleError,
            queries: queryStore.queries,
            sdk: isNestjs ? "nest" : "express",
          });
        }
      });
    } catch (err) {
      if (debug) {
        console.error('Treblle middleware error:', err);
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
  res.send = function(body) {
    res.__treblle_body_response = body;
    return originalSend.call(this, body);
  };

  // Override json method
  res.json = function(obj) {
    res.__treblle_body_response = obj;
    return originalJson.call(this, obj);
  };

  // Override end method as fallback
  res.end = function(chunk, encoding) {
    if (chunk && !res.__treblle_body_response) {
      res.__treblle_body_response = chunk;
    }
    return originalEnd.call(this, chunk, encoding);
  };
}

/**
 * Treblle middleware for koa.
 *
 * @param {string} sdkToken Treblle SDK token
 * @param {string} apiKey Treblle API key
 * @param {string[]?} additionalFieldsToMask specify additional fields to hide
 * @param {(string[]|RegExp)?} blocklistPaths specify additional paths to hide
 * @param {boolean?} ignoreDefaultBlockedPaths ignore default blocked paths (favicon.ico, robots.txt, etc.)
 * @param {boolean?} debug controls error logging when sending data to Treblle
 * @param {string?} endpoint custom Treblle ingress endpoint (e.g. "https://ingress-eu.treblle.com")
 * @returns {function} koa middleware function
 */
function koaTreblle({
  sdkToken,
  apiKey,
  additionalFieldsToMask = [],
  blocklistPaths = [],
  ignoreDefaultBlockedPaths = false,
  debug = false,
  endpoint,
}) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);

  return async function (ctx, next) {
    // Check if the request path is blocked
    const pathBlocked = isPathBlocked(extractPathname(ctx.request.url), blocklistPaths, ignoreDefaultBlockedPaths);

    if (pathBlocked) {
      return next();
    }

    return koaMiddlewareFn({
      ctx,
      next,
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      debug,
      endpoint,
    });
  };
}

/**
 * Treblle middleware for strapi.
 *
 * @param {string} sdkToken Treblle SDK token
 * @param {string} apiKey Treblle API key
 * @param {string[]?} additionalFieldsToMask specify additional fields to hide
 * @param {(string[]|RegExp)?} settings.blocklistPaths specify additional paths to hide
 * @param {boolean?} ignoreDefaultBlockedPaths ignore default blocked paths (favicon.ico, robots.txt, etc.)
 * @param {boolean?} debug controls error logging when sending data to Treblle
 * @param {string?} endpoint custom Treblle ingress endpoint (e.g. "https://ingress-eu.treblle.com")
 * @param {string[]} ignoreAdminRoutes controls logging /admin routes
 * @returns {function} koa middleware function
 */
function strapiTreblle({
  sdkToken,
  apiKey,
  additionalFieldsToMask = [],
  blocklistPaths = [],
  ignoreDefaultBlockedPaths = false,
  debug = false,
  endpoint,
  ignoreAdminRoutes = ["admin", "content-type-builder", "content-manager"],
}) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);

  return async function (ctx, next) {
    const pathname = extractPathname(ctx.request.url);

    // option to ignore admin routes since everything is served via koa
    const [_, path] = pathname.split("/");
    if (ignoreAdminRoutes.includes(path)) {
      return next();
    }

    // Check if the request path is blocked
    const pathBlocked = isPathBlocked(pathname, blocklistPaths, ignoreDefaultBlockedPaths);

    if (pathBlocked) {
      return next();
    }

    return koaMiddlewareFn({
      ctx,
      next,
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      debug,
      endpoint,
      sdk: "strapi",
    });
  };
}

async function koaMiddlewareFn({
  ctx,
  next,
  sdkToken,
  apiKey,
  fieldsToMaskMap,
  debug,
  endpoint,
  sdk = "koa",
}) {
  const requestStartTime = process.hrtime();
  const queryStore = createQueryStore();

  try {
    await runWithQueryContext(queryStore, () => next());
    sendKoaPayloadToTreblle(ctx, {
      sdkToken,
      apiKey,
      requestStartTime,
      fieldsToMaskMap,
      debug,
      endpoint,
      queries: queryStore.queries,
      sdk,
    });
  } catch (error) {
    sendKoaPayloadToTreblle(ctx, {
      sdkToken,
      apiKey,
      requestStartTime,
      fieldsToMaskMap,
      debug,
      endpoint,
      error,
      queries: queryStore.queries,
      sdk,
    });
    throw error;
  }
}


/**
 * Treblle middleware for Hono.
 *
 * @param {string} sdkToken Treblle SDK token
 * @param {string} apiKey Treblle API key
 * @param {string[]?} additionalFieldsToMask specify additional fields to hide
 * @param {(string[]|RegExp)?} blocklistPaths specify additional paths to hide
 * @param {boolean?} ignoreDefaultBlockedPaths ignore default blocked paths (favicon.ico, robots.txt, etc.)
 * @param {boolean?} debug controls error logging when sending data to Treblle
 * @param {string?} endpoint custom Treblle ingress endpoint (e.g. "https://ingress-eu.treblle.com")
 * @returns {function} hono middleware function
 */
function honoTreblle({
  sdkToken,
  apiKey,
  additionalFieldsToMask = [],
  blocklistPaths = [],
  ignoreDefaultBlockedPaths = false,
  debug = false,
  endpoint,
}) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);

  return async function (c, next) {
    // Check if the request path is blocked
    const pathBlocked = isPathBlocked(extractPathname(c.req.url), blocklistPaths, ignoreDefaultBlockedPaths);

    if (pathBlocked) {
      return next();
    }

    return honoMiddlewareFn({
      c,
      next,
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      debug,
      endpoint,
    });
  };
}

async function honoTask({
  c,
  sdkToken,
  apiKey,
  requestStartTime,
  fieldsToMaskMap,
  debug,
  endpoint,
  error,
  queries,
}) {
  try {
    await captureHonoRequestBody(c);
    await captureHonoResponseBody(c);
  } finally {
    await sendHonoPayloadToTreblle(c, {
      sdkToken,
      apiKey,
      requestStartTime,
      fieldsToMaskMap,
      debug,
      endpoint,
      error,
      queries,
    })
  }
}

async function honoMiddlewareFn({
  c,
  next,
  sdkToken,
  apiKey,
  fieldsToMaskMap,
  debug,
  endpoint,
}) {
  const requestStartTime = createStartTime();
  const queryStore = createQueryStore();
  const wrapper = 'executionCtx' in c ? c.executionCtx.waitUntil.bind(c.executionCtx) : (p) => p.catch(() => {})

  try {
    await runWithQueryContext(queryStore, () => next());
    wrapper(
      honoTask({
        c,
        sdkToken,
        apiKey,
        requestStartTime,
        fieldsToMaskMap,
        debug,
        endpoint,
        queries: queryStore.queries,
      })
    );

  } catch (error) {
    wrapper(
      honoTask({
        c,
        sdkToken,
        apiKey,
        requestStartTime,
        fieldsToMaskMap,
        debug,
        endpoint,
        error,
        queries: queryStore.queries,
      })
    );
    throw error;
  }
}

async function captureHonoRequestBody(c) {
  try {
    if (c.req?.method !== 'GET') {
      const contentType = c.req.header('content-type') || '';
      let requestBody = null;

      // Read the body exactly once, based on the content type. Reading it
      // more than once can consume the underlying stream and lose data.
      try {
        if (contentType.includes('application/json')) {
          requestBody = await c.req.json();
        } else if (
          contentType.includes('form-urlencoded') ||
          contentType.includes('multipart/form-data')
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

      let responseBody, responseBodySize
      if (clonedResponse.headers.has('content-length')) {
        responseBodySize = parseInt(clonedResponse.headers.get('content-length'));
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

module.exports = {
  useTreblle,
  koaTreblle,
  strapiTreblle,
  useNestTreblle,
  honoTreblle,
  // Exported for unit testing
  isPathBlocked,
  extractPathname,
};
