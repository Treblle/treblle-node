const fetch = require("node-fetch")
const os = require("os");
const url = require("url");

/**
 * Adds the trebble middleware to the app.
 *
 * @param {obj} app Express app
 * @param {obj} settings
 * @param {string} settings.apiKey Trebble API key
 * @param {string} settings.projectId Trebble Project ID
 */
const useTreblle = function (app, { apiKey, projectId }) {
  function trebbleMiddleware(req, res, next) {
    try {
      const requestStartTime = process.hrtime();

      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("application/json")) {
        return next();
      }

      res.on("finish", function () {
        let trebllePayload = generateTrebllePayload(req, res, {
          apiKey,
          projectId,
          requestStartTime,
        });

        fetch("https://rocknrolla.treblle.com", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify(trebllePayload),
        });
      });
    } catch (error) {
      console.error(error);
    } finally {
      next();
    }
  }

  // we need to overwrite the default send to be ablle to access it
  const originalSend = app.response.send;
  app.response.send = function sendOverWrite(body) {
    originalSend.call(this, body);
    this.__treblle_body_response = body;
  };

  app.use(trebbleMiddleware);

  return app;
};

/**
 * Prepares the payload which is sent to Treblle.
 *
 * @param {obj} Express request object
 * @param {obj} Express response object
 * @param {obj} settings
 * @param {string} settings.apiKey Treblle API Key
 * @param {string} settings.projectId Treblle Project ID
 * @param {number[]} settings.requestStartTime when the request started
 */
const generateTrebllePayload = function (
  req,
  res,
  { apiKey, projectId, requestStartTime }
) {
  const requestBody = maskSensitiveValues(req.body);
  let responseBody = res.__treblle_body_response;

  const responseHeaders = res.getHeaders();
  if (responseHeaders["content-type"].includes("application/json")) {
    // We should be able to parse this, but you never know if users will try doing something weird...
    try {
      responseBody = JSON.parse(res.__treblle_body_response);
      responseBody = maskSensitiveValues(responseBody);
    } catch {
      // do nothing if we can't parse the response, in this case we'll have the response's original values untouched
    }
  }

  const protocol = `${req.protocol.toUpperCase()}/${req.httpVersion}`;

  res.__treblle_body_response = null;

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
        load_time: getLoadTime(requestStartTime).toLocaleString(),
        body: responseBody !== undefined ? responseBody : null,
      },
      errors: [],
    },
  };

  return dataToSend;
};

/**
 * Calculates the request duration in microseconds.
 *
 * @param {number[]} startTime
 * @returns {number}
 */
function getLoadTime(startTime) {
  const NS_PER_SEC = 1e9;
  const NS_TO_MICRO = 1e3;
  const diff = process.hrtime(startTime);

  return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MICRO;
}

module.exports = {
  useTreblle,
};

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
 * Takes an object representing the payload and masks its sensitive fields.
 *
 * @param {object} payloadObject
 * @returns {object}
 */
function maskSensitiveValues(payloadObject) {
  if (typeof payloadObject !== "object") return payloadObject;
  if (Array.isArray(payloadObject)) {
    return payloadObject.map(maskSensitiveValues);
  }

  let objectToMask = { ...payloadObject };

  let safeObject = Object.keys(objectToMask).reduce(function (acc, propName) {
    if (typeof objectToMask[propName] === "string") {
      if (fieldsToMask.includes(propName)) {
        acc[propName] = "*".repeat(objectToMask[propName].length);
      } else {
        acc[propName] = objectToMask[propName];
      }
    } else if (Array.isArray(objectToMask[propName])) {
      acc[propName] = objectToMask[propName].map(maskSensitiveValues);
    } else if (typeof objectToMask[propName] === "object") {
      acc[propName] = maskSensitiveValues(objectToMask[propName]);
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
