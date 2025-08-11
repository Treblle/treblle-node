const finalhandler = require("finalhandler");
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
  patchApp(app, { sdkToken, apiKey, fieldsToMaskMap, debug });
  app.use(
    TreblleMiddleware({
      sdkToken,
      apiKey,
      fieldsToMaskMap,
      blocklistPaths,
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
  patchApp(app, {
    sdkToken,
    apiKey,
    fieldsToMaskMap,
    debug,
    blocklistPaths,
  });
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

  return app;
};

/**
 * Takes the express app and overrides it's methods
 * so we can integrate Treblle middleware into it.
 *
 * @param {object} app Express app
 * @param {object} settings
 * @param {string} settings.sdkToken Treblle SDK token
 * @param {string} settings.apiKey Treblle API key
 * @param {object} settings.additionalFieldsToMask specificy additional fields to hide
 * @returns {undefined}
 */
function patchApp(app, { sdkToken, apiKey, fieldsToMaskMap, debug }) {
  // we need to overwrite the default send to be able to access the response body
  const originalSend = app.response.send;
  app.response.send = function sendOverWrite(body) {
    originalSend.call(this, body);
    // this is a workaround so we can access the response body
    this.__treblle_body_response = body;
  };

  // We override ExpressJS's app.handle function to avoid having to register our own error handling middleware,
  // This way we do things a bit more hacky but the user doesn't have to register 2 middlewares: a regular one and a error handling one.
  app.handle = function handle(req, res, callback) {
    var router = this._router;
    let self = this;

    function expandedLogError(error) {
      sendExpressPayloadToTreblle(req, res, {
        error,
        sdkToken,
        apiKey,
        fieldsToMaskMap,
        // in case of error the request time will be faulty
        requestStartTime: process.hrtime(),
        debug,
      });

      logerror.call(self, error);
    }

    // final handler
    var done =
      callback ||
      finalhandler(req, res, {
        env: this.get("env"),
        onerror: expandedLogError,
      });

    // no routes
    if (!router) {
      debug("no routes defined on app");
      done();
      return;
    }

    router.handle(req, res, done);
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

      res.on("finish", function () {
        if (
          !isNestjs &&
          (res.statusCode === 500 ||
            res.statusMessage === "Internal Server Error")
        ) {
          // This prevents duplicate payload sending to Treblle API in case we have an error.
          // The error will get caught by the app.handle's error handler.
          return next();
        }

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
      console.error(err);
    } finally {
      next && next();
    }
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

function logerror(err) {
  /* istanbul ignore next */
  if (this.get("env") !== "test") console.error(err.stack || err.toString());
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
