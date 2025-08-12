const { generateFieldsToMaskMap } = require("./maskFields");
const {
  sendExpressPayloadToTreblle,
  sendKoaPayloadToTreblle,
  sendHonoPayloadToTreblle,
  createStartTime,
} = require("./sender");

/**
 * Adds the Treblle middleware to the app.
 *
 * @param {object} app Express app
 * @param {object} settings
 * @param {string} settings.sdkToken Treblle SDK token
 * @param {string} settings.apiKey Treblle API key
 * @param {string[]?} settings.additionalFieldsToMask specify additional fields to hide
 * @param {(string[]|RegExp)?} settings.blocklistPaths specify additional paths to hide
 * @param {boolean?} settings.debug controls error logging when sending data to Treblle
 * @returns {object} updated Express app
 */
const useTreblle = function (
  app,
  {
    sdkToken,
    apiKey,
    additionalFieldsToMask = [],
    blocklistPaths = [],
    debug = false,
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
      debug,
    })
  );

  // Add error handling middleware
  app.use(
    TreblleErrorMiddleware({
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      debug,
    })
  );

  return app;
};

/**
 * Adds the Treblle middleware to the app.
 *
 * @param {object} app Express app
 * @param {object} settings
 * @param {string} settings.sdkToken Treblle SDK token
 * @param {string} settings.apiKey Treblle API key
 * @param {string[]?} settings.additionalFieldsToMask specify additional fields to hide
 * @param {(string[]|RegExp)?} settings.blocklistPaths specify additional paths to hide
 * @param {boolean?} settings.debug controls error logging when sending data to Treblle
 * @returns {object} updated Express app
 */
const useNestTreblle = function (
  app,
  {
    sdkToken,
    apiKey,
    additionalFieldsToMask = [],
    blocklistPaths = [],
    debug = false,
  }
) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);
  
  // Use standard middleware approach instead of patching
  app.use(
    TreblleMiddleware({
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      debug,
      blocklistPaths,
      isNestjs: true,
    })
  );

  // Add error handling middleware
  app.use(
    TreblleErrorMiddleware({
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      debug,
    })
  );

  return app;
};

/**
 * Error handling middleware for Treblle.
 * This replaces the invasive app.handle patching with standard Express error middleware.
 *
 * @param {object} settings
 * @param {string} settings.sdkToken Treblle SDK token
 * @param {string} settings.apiKey Treblle API key
 * @param {object} settings.fieldsToMaskMap map of fields to mask
 * @param {boolean} settings.debug controls error logging
 * @returns {function} Express error middleware
 */
function TreblleErrorMiddleware({
  sdkToken,
  apiKey,
  fieldsToMaskMap,
  debug,
}) {
  return function _TreblleErrorMiddleware(err, req, res, next) {
    try {
      // Send error data to Treblle
      sendExpressPayloadToTreblle(req, res, {
        error: err,
        sdkToken,
        apiKey,
        fieldsToMaskMap,
        requestStartTime: req._treblleStartTime || process.hrtime(),
        debug,
      });
    } catch (treblleError) {
      if (debug) {
        console.error('Treblle error middleware failed:', treblleError);
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
  debug,
  isNestjs,
}) {
  return function _TreblleMiddlewareHandler(req, res, next) {
    try {
      const requestStartTime = process.hrtime();
      req._treblleStartTime = requestStartTime;

      // Non-invasive response body capture using response event listeners
      captureResponseBody(res);

      res.on("finish", function () {
        // Check if the request path is blocked
        const isPathBlocked =
          blocklistPaths instanceof RegExp
            ? blocklistPaths.test(req.path)
            : blocklistPaths.some((path) => req.path.startsWith(`/${path}`));

        if (!isPathBlocked) {
          sendExpressPayloadToTreblle(req, res, {
            sdkToken,
            apiKey,
            requestStartTime,
            fieldsToMaskMap,
            debug,
          });
        }
      });
    } catch (err) {
      if (debug) {
        console.error('Treblle middleware error:', err);
      }
    } finally {
      next && next();
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
 * @param {boolean?} debug controls error logging when sending data to Treblle
 * @returns {function} koa middleware function
 */
function koaTreblle({
  sdkToken,
  apiKey,
  additionalFieldsToMask = [],
  blocklistPaths = [],
  debug = false,
}) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);

  return async function (ctx, next) {
    // Check if the request path is blocked
    const isPathBlocked =
      blocklistPaths instanceof RegExp
        ? blocklistPaths.test(ctx.request.url)
        : blocklistPaths.some((path) => ctx.request.url.startsWith(`/${path}`));

    if (isPathBlocked) {
      return next();
    }

    return koaMiddlewareFn({
      ctx,
      next,
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      debug,
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
 * @param {boolean?} debug controls error logging when sending data to Treblle
 * @param {string[]} ignoreAdminRoutes controls logging /admin routes
 * @returns {function} koa middleware function
 */
function strapiTreblle({
  sdkToken,
  apiKey,
  additionalFieldsToMask = [],
  blocklistPaths = [],
  debug = false,
  ignoreAdminRoutes = ["admin", "content-type-builder", "content-manager"],
}) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);

  return async function (ctx, next) {
    // option to ignore admin routes since everything is served via koa
    const [_, path] = ctx.request.url.split("/");
    if (ignoreAdminRoutes.includes(path)) {
      return next();
    }

    // Check if the request path is blocked
    const isPathBlocked =
      blocklistPaths instanceof RegExp
        ? blocklistPaths.test(ctx.request.url)
        : blocklistPaths.some((path) => ctx.request.url.startsWith(`/${path}`));

    if (isPathBlocked) {
      return next();
    }

    return koaMiddlewareFn({
      ctx,
      next,
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      debug,
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
}) {
  const requestStartTime = process.hrtime();

  try {
    await next();
    sendKoaPayloadToTreblle(ctx, {
      sdkToken,
      apiKey,
      requestStartTime,
      fieldsToMaskMap,
      debug,
    });
  } catch (error) {
    sendKoaPayloadToTreblle(ctx, {
      sdkToken,
      apiKey,
      requestStartTime,
      fieldsToMaskMap,
      debug,
      error,
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
 * @param {boolean?} debug controls error logging when sending data to Treblle
 * @returns {function} hono middleware function
 */
function honoTreblle({
  sdkToken,
  apiKey,
  additionalFieldsToMask = [],
  blocklistPaths = [],
  debug = false,
}) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);

  return async function (c, next) {
    // Check if the request path is blocked
    const isPathBlocked =
      blocklistPaths instanceof RegExp
        ? blocklistPaths.test(c.req.url)
        : blocklistPaths.some((path) => c.req.url.startsWith(`/${path}`));

    if (isPathBlocked) {
      return next();
    }

    return honoMiddlewareFn({
      c,
      next,
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      debug,
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
  error,
}) {
  try {
    await captureHonoResponseBody(c);
  } finally {
    await sendHonoPayloadToTreblle(c, {
      sdkToken,
      apiKey,
      requestStartTime,
      fieldsToMaskMap,
      debug,
      error,
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
}) {
  const requestStartTime = createStartTime();
  const wrapper = 'executionCtx' in c ? c.executionCtx.waitUntil.bind(c.executionCtx) : (p) => p.catch(() => {})

  try {
    await next();
    wrapper(
      honoTask({
        c,
        sdkToken,
        apiKey,
        requestStartTime,
        fieldsToMaskMap,
        debug,
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
        error,
      })
    );
    throw error;
  }
}

async function captureHonoResponseBody(c) {
  try {
    if (c.res && c.res.body) {
      // Clone the response to read the body without consuming it
      const clonedResponse = c.res.clone();

      // Try to read as text first
      let responseBody;
      try {
        responseBody = await clonedResponse.text();
      } catch {
        // If text fails, try reading as arrayBuffer and convert
        try {
          const buffer = await clonedResponse.arrayBuffer();
          responseBody = new TextDecoder().decode(buffer);
        } catch {
          // If all fails, leave it null
          responseBody = null;
        }
      }

      // Store captured body for later access
      c.__treblle_body_response = responseBody;
    }
  } catch (error) {
    // If capture fails, continue without body data
    c.__treblle_body_response = null;
  }
}

module.exports = {
  useTreblle,
  koaTreblle,
  strapiTreblle,
  useNestTreblle,
  honoTreblle,
};
