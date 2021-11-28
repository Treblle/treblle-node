const finalhandler = require("finalhandler");
const { generateFieldsToMaskMap } = require("./maskFields");
const {
  sendExpressPayloadToTreblle,
  sendKoaPayloadToTreblle,
} = require("./sender");

/**
 * Adds the Treblle middleware to the app.
 *
 * @param {object} app Express app
 * @param {object} settings
 * @param {string} settings.apiKey Treblle API key
 * @param {string} settings.projectId Treblle Project ID
 * @param {string[]?} settings.additionalFieldsToMask specify additional fields to hide
 * @param {boolean?} settings.showErrors controls error logging when sending data to Treblle
 * @returns {object} updated Express app
 */
const useTreblle = function (
  app,
  { apiKey, projectId, additionalFieldsToMask = [], showErrors = true }
) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);
  patchApp(app, { apiKey, projectId, fieldsToMaskMap, showErrors });
  app.use(
    TreblleMiddleware({ apiKey, projectId, fieldsToMaskMap, showErrors })
  );

  return app;
};

/**
 * Takes the express app and overrides it's methods
 * so we can integrate Treblle middleware into it.
 *
 * @param {object} app Express app
 * @param {object} settings
 * @param {string} settings.apiKey Treblle API key
 * @param {string} settings.projectId Treblle Project ID
 * @param {object} settings.additionalFieldsToMask specificy additional fields to hide
 * @returns {undefined}
 */
function patchApp(app, { apiKey, projectId, fieldsToMaskMap, showErrors }) {
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
        apiKey,
        projectId,
        fieldsToMaskMap,
        // in case of error the request time will be faulty
        requestStartTime: process.hrtime(),
        showErrors,
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

function TreblleMiddleware({ apiKey, projectId, fieldsToMaskMap, showErrors }) {
  return function _TreblleMiddlewareHandler(req, res, next) {
    try {
      const requestStartTime = process.hrtime();

      res.on("finish", function () {
        if (
          res.statusCode === 500 ||
          res.statusMessage === "Internal Server Error"
        ) {
          // This prevents duplicate payload sending to Treblle API in case we have an error.
          // The error will get caught by the app.handle's error handler.
          return next();
        }

        sendExpressPayloadToTreblle(req, res, {
          apiKey,
          projectId,
          requestStartTime,
          fieldsToMaskMap,
          showErrors,
        });
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
 * @param {string} apiKey Treblle API key
 * @param {string} projectId Treblle Project ID
 * @param {string[]?} additionalFieldsToMask specify additional fields to hide
 * @param {boolean?} showErrors controls error logging when sending data to Treblle
 * @returns {function} koa middleware function
 */
function koaTreblle({
  apiKey,
  projectId,
  additionalFieldsToMask = [],
  showErrors = true,
}) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);

  return async function (ctx, next) {
    return koaMiddlewareFn({
      ctx,
      next,
      apiKey,
      projectId,
      fieldsToMaskMap,
      showErrors,
    });
  };
}

/**
 * Treblle middleware for strapi.
 *
 * @param {string} apiKey Treblle API key
 * @param {string} projectId Treblle Project ID
 * @param {string[]?} additionalFieldsToMask specify additional fields to hide
 * @param {boolean?} showErrors controls error logging when sending data to Treblle
 * @param {boolean?} ignoreAdminRoutes controls logging /admin routes
 * @returns {function} koa middleware function
 */
function strapiTreblle({
  apiKey,
  projectId,
  additionalFieldsToMask = [],
  showErrors = true,
  ignoreAdminRoutes = true,
}) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);

  return async function (ctx, next) {
    // option to ignore admin routes since everything is served via koa
    if (ignoreAdminRoutes && ctx.request.url.startsWith("/admin")) {
      return next();
    }

    return koaMiddlewareFn({
      ctx,
      next,
      apiKey,
      projectId,
      fieldsToMaskMap,
      showErrors,
    });
  };
}

async function koaMiddlewareFn({
  ctx,
  next,
  apiKey,
  projectId,
  fieldsToMaskMap,
  showErrors,
}) {
  const requestStartTime = process.hrtime();

  try {
    await next();
    sendKoaPayloadToTreblle(ctx, {
      apiKey,
      projectId,
      requestStartTime,
      fieldsToMaskMap,
      showErrors,
    });
  } catch (error) {
    sendKoaPayloadToTreblle(ctx, {
      apiKey,
      projectId,
      requestStartTime,
      fieldsToMaskMap,
      showErrors,
    });
    throw error;
  }
}

function logerror(err) {
  /* istanbul ignore next */
  if (this.get("env") !== "test") console.error(err.stack || err.toString());
}

module.exports = {
  useTreblle,
  koaTreblle,
  strapiTreblle,
};
