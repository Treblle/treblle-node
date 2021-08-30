const finalhandler = require("finalhandler");
const { generateFieldsToMaskMap } = require("./maskFields");
const { sendPayloadToTrebble } = require("./sender");

/**
 * Adds the trebble middleware to the app.
 *
 * @param {object} app Express app
 * @param {object} settings
 * @param {string} settings.apiKey Trebble API key
 * @param {string} settings.projectId Trebble Project ID
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
    trebbleMiddleware({ apiKey, projectId, fieldsToMaskMap, showErrors })
  );

  return app;
};

/**
 * Takes the express app and overrides it's methods
 * so we can integrate Treblle middleware into it.
 *
 * @param {object} app Express app
 * @param {object} settings
 * @param {string} settings.apiKey Trebble API key
 * @param {string} settings.projectId Trebble Project ID
 * @param {object} settings.additionalFieldsToMask specificy additional fields to hide
 * @returns {undefined}
 */
function patchApp(app, { apiKey, projectId, fieldsToMaskMap, showErrors }) {
  // we need to overwrite the default send to be able to access the response body
  const originalSend = app.response.send;
  app.response.send = function sendOverWrite(body) {
    originalSend.call(this, body);
    this.__treblle_body_response = body;
  };

  // We override ExpressJS's app.handle function to avoid having to register our own error handling middleware,
  // This way we do things a bit more hacky but the user doesn't have to register 2 middlewares: a regular one and a error handling one.
  app.handle = function handle(req, res, callback) {
    var router = this._router;
    let self = this;

    function expandedLogError(error) {
      sendPayloadToTrebble(req, res, {
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

function trebbleMiddleware({ apiKey, projectId, fieldsToMaskMap, showErrors }) {
  return function _trebbleMiddlewareHandler(req, res, next) {
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

        sendPayloadToTrebble(req, res, {
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

function logerror(err) {
  /* istanbul ignore next */
  if (this.get("env") !== "test") console.error(err.stack || err.toString());
}

module.exports = {
  useTreblle,
};
