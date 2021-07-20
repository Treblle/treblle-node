const os = require("os");
const url = require("url");
const fetch = require("node-fetch");
const stackTrace = require("stack-trace");
const finalhandler = require("finalhandler");

/**
 * Adds the trebble middleware to the app.
 *
 * @param {object} app Express app
 * @param {object} settings
 * @param {string} settings.apiKey Trebble API key
 * @param {string} settings.projectId Trebble Project ID
 * @param {string[]?} settings.additionalFieldsToMask specificy additional fields to hide
 * @returns {object} updated Express app
 */
const useTreblle = function (app, { apiKey, projectId, additionalFieldsToMask = []}) {
  const fieldsToMask = generateFieldsToMask(additionalFieldsToMask)
  patchApp(app, { apiKey, projectId, fieldsToMask });
  app.use(trebbleMiddleware(apiKey, projectId, fieldsToMask));

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
function patchApp(app, { apiKey, projectId, fieldsToMaskMap }) {
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

function trebbleMiddleware(apiKey, projectId, fieldsToMaskMap) {
  return function _trebbleMiddlewareHandler(req, res, next) {
    try {
      const requestStartTime = process.hrtime();

      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("application/json")) {
        return next();
      }

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
 * Prepares the payload which is sent to Treblle.
 *
 * @param {object} Express request object
 * @param {object} Express response object
 * @param {object} settings
 * @param {string} settings.apiKey Treblle API Key
 * @param {string} settings.projectId Treblle Project ID
 * @param {number[]} settings.requestStartTime when the request started
 */
const generateTrebllePayload = function (
  req,
  res,
  { apiKey, projectId, requestStartTime, error, fieldsToMaskMap }
) {
  const requestBody = maskSensitiveValues(req.body, fieldsToMaskMap);
  let responseBody = res.__treblle_body_response;

  const responseHeaders = res.getHeaders();
  if (responseHeaders["content-type"].includes("application/json")) {
    // We should be able to parse this, but you never know if users will try doing something weird...
    try {
      responseBody = JSON.parse(res.__treblle_body_response);
      responseBody = maskSensitiveValues(responseBody, fieldsToMaskMap);
    } catch {
      // do nothing if we can't parse the response, in this case we'll have the response's original values untouched
    }
  }

  const protocol = `${req.protocol.toUpperCase()}/${req.httpVersion}`;

  res.__treblle_body_response = null;

  let errors = [];
  if (error) {
    const trace = stackTrace.parse(error);

    errors = [
      {
        source: "onException",
        type: "UNHANDLED_EXCEPTION",
        message: error.message,
        file: trace[0].getFileName(),
        line: trace[0].getLineNumber(),
      },
    ];
  }

  let dataToSend = {
    api_key: apiKey,
    project_id: projectId,
    version: 0.6,
    sdk: "node",
    data: {
      server: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        os: {
          name: os.platform(),
          release: os.release(),
          architecture: os.arch(),
        },
        software: null,
        signature: null,
        protocol: protocol,
      },
      language: {
        name: "node",
        version: process.version,
      },
      request: {
        timestamp: new Date().toISOString().replace("T", " ").substr(0, 19),
        ip: req.ip,
        url: getRequestUrl(req),
        user_agent: req.get("user-agent"),
        method: req.method,
        headers: req.headers,
        body: requestBody !== undefined ? requestBody : null,
      },
      response: {
        headers: responseHeaders,
        code: res.statusCode,
        size: res._contentLength,
        load_time: getRequestDuration(requestStartTime),
        body: responseBody !== undefined ? responseBody : null,
      },
      errors: errors,
    },
  };

  return dataToSend;
};

function sendPayloadToTrebble(
  req,
  res,
  { apiKey, projectId, requestStartTime, error, fieldsToMaskMap }
) {
  let trebllePayload = generateTrebllePayload(req, res, {
    apiKey,
    projectId,
    requestStartTime,
    error,
    fieldsToMaskMap
  });

  fetch("https://rocknrolla.treblle.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(trebllePayload),
  });
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

const fieldsToMask = [
  "password",
  "pwd",
  "secret",
  "password_confirmation",
  "passwordConfirmation",
  "cc",
  "card_number",
  "cardNumber",
  "ccv",
  "ssn",
  "credit_score",
  "creditScore",
];

/**
 * Generates an object of fields to mask.
 *
 * We'll use an object because it's faster to check if a key exists in an object,
 * then it is to check if the key exists in an array.
 *
 * @param {string[]?} additionalFieldsToMask
 * @returns {object}
 */
function generateFieldsToMask(additionalFieldsToMask = []) {
  const fields = [...fieldsToMask, ...additionalFieldsToMask];
  const fieldsMap = fields.reduce((acc, field) => {
    acc[field] = true
    return acc
  }, {});
  return fieldsMap;
}

/**
 * Takes an object representing the payload and masks its sensitive fields.
 *
 * @param {object} payloadObject
 * @returns {object}
 */
function maskSensitiveValues(payloadObject, fieldsToMaskMap) {
  if (typeof payloadObject !== "object") return payloadObject;
  if (Array.isArray(payloadObject)) {
    return payloadObject.map(val => maskSensitiveValues(val, fieldsToMaskMap));
  }

  let objectToMask = { ...payloadObject };

  let safeObject = Object.keys(objectToMask).reduce(function (acc, propName) {
    if (typeof objectToMask[propName] === "string") {
      if (fieldsToMaskMap[propName] === true) {
        acc[propName] = "*".repeat(objectToMask[propName].length);
      } else {
        acc[propName] = objectToMask[propName];
      }
    } else if (Array.isArray(objectToMask[propName])) {
      acc[propName] = objectToMask[propName].map(val => maskSensitiveValues(val, fieldsToMaskMap));
    } else if (typeof objectToMask[propName] === "object") {
      acc[propName] = maskSensitiveValues(objectToMask[propName], fieldsToMaskMap);
    } else {
      acc[propName] = objectToMask[propName];
    }

    return acc;
  }, {});

  return safeObject;
}

function getRequestUrl(req) {
  return url.format({
    protocol: req.protocol,
    host: req.get("host"),
    pathname: req.originalUrl,
  });
}

function logerror(err) {
  /* istanbul ignore next */
  if (this.get("env") !== "test") console.error(err.stack || err.toString());
}

module.exports = {
  useTreblle,
};