const { maskSensitiveValues } = require("./maskFields");
const os = require("os");
const fetch = require("node-fetch");
const stackTrace = require("stack-trace");
const VERSION = require("../package.json").version;

/**
 * Prepares the payload which is sent to Treblle.
 *
 * @param {object} Express request object
 * @param {object} Express response object
 * @param {object} settings
 * @param {string} settings.apiKey Treblle API Key
 * @param {string} settings.projectId Treblle Project ID
 * @param {number[]} settings.requestStartTime when the request started
 * @param {object} settings.fieldsToMaskMap map of fields to mask
 */
const generateTrebllePayload = function (
  req,
  res,
  { apiKey, projectId, requestStartTime, error, fieldsToMaskMap }
) {
  const payload = req.method === "GET" ? req.query : req.body;
  const parsedPayload = getPayload(payload);
  const maskedRequestPayload = maskSensitiveValues(
    parsedPayload,
    fieldsToMaskMap
  );

  const responseHeaders = res.getHeaders();

  let errors = [];

  // We should be able to parse this, but you never know if users will try doing something weird...
  let maskedResponseBody;
  try {
    let originalResponseBody = res.__treblle_body_response;
    // if the response is streamed it could be a buffer
    // so we'll convert it to a string first
    if (Buffer.isBuffer(originalResponseBody)) {
      originalResponseBody = originalResponseBody.toString("utf8");
    }

    if (typeof originalResponseBody === "string") {
      let parsedResponseBody = JSON.parse(originalResponseBody);
      maskedResponseBody = maskSensitiveValues(
        parsedResponseBody,
        fieldsToMaskMap
      );
    } else if (typeof originalResponseBody === "object") {
      maskedResponseBody = maskSensitiveValues(
        originalResponseBody,
        fieldsToMaskMap
      );
    }
  } catch {
    // if we can't parse the body we'll leave it empty and set an error
    errors.push({
      source: "onShutdown",
      type: "INVALID_JSON",
      message: "Invalid JSON format",
      file: null,
      line: null,
    });
  }

  const protocol = `${req.protocol.toUpperCase()}/${req.httpVersion}`;

  // get rid of the workaround body, we don't need it anymore
  res.__treblle_body_response = null;

  if (error) {
    const trace = stackTrace.parse(error);

    errors.push({
        source: "onException",
        type: "UNHANDLED_EXCEPTION",
        message: error.message,
        file: trace[0].getFileName(),
        line: trace[0].getLineNumber(),
    });
  }

  let dataToSend = {
    api_key: apiKey,
    project_id: projectId,
    version: VERSION,
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
        body: maskedRequestPayload !== undefined ? maskedRequestPayload : null,
      },
      response: {
        headers: responseHeaders,
        code: res.statusCode,
        size: res._contentLength,
        load_time: getRequestDuration(requestStartTime),
        body: maskedResponseBody !== undefined ? maskedResponseBody : null,
      },
      errors: errors,
    },
  };

  return dataToSend;
};

/**
 * Prepares the payload which is sent to Treblle.
 *
 * @param {object} Koa context object
 * @param {object} settings
 * @param {string} settings.apiKey Treblle API Key
 * @param {string} settings.projectId Treblle Project ID
 * @param {number[]} settings.requestStartTime when the request started
 * @param {object} settings.fieldsToMaskMap map of fields to mask
 */
const generateKoaTrebllePayload = function (
  koaContext,
  { apiKey, projectId, requestStartTime, error, fieldsToMaskMap }
) {
  const payload =
    koaContext.request.method === "GET"
      ? koaContext.request.query
      : koaContext.request.body;
  const parsedPayload = getPayload(payload);
  const maskedRequestPayload = maskSensitiveValues(
    parsedPayload,
    fieldsToMaskMap
  );

  const responseHeaders = koaContext.response.headers;

  let errors = [];

  // We should be able to parse this, but you never know if users will try doing something weird...
  // TODO - figure out Koa buffers & streaming
  let maskedResponseBody;
  try {
    let originalResponseBody = koaContext.response.body;
    // if the response is streamed it could be a buffer
    // so we'll convert it to a string first
    if (Buffer.isBuffer(originalResponseBody)) {
      originalResponseBody = originalResponseBody.toString("utf8");
    }

    if (typeof originalResponseBody === "string") {
      let parsedResponseBody = JSON.parse(originalResponseBody);
      maskedResponseBody = maskSensitiveValues(
        parsedResponseBody,
        fieldsToMaskMap
      );
    } else if (typeof originalResponseBody === "object") {
      maskedResponseBody = maskSensitiveValues(
        originalResponseBody,
        fieldsToMaskMap
      );
    }
  } catch {
    // if we can't parse the body we'll leave it empty and set an error
    errors.push({
      source: "onShutdown",
      type: "INVALID_JSON",
      message: "Invalid JSON format",
      file: null,
      line: null,
    });
  }

  const protocol = `${koaContext.request.protocol.toUpperCase()}/${
    koaContext.request.req.httpVersion
  }`;

  if (error) {
    const trace = stackTrace.parse(error);

    errors.push({
        source: "onException",
        type: "UNHANDLED_EXCEPTION",
        message: error.message,
        file: trace[0].getFileName(),
        line: trace[0].getLineNumber(),
    });
  }

  let dataToSend = {
    api_key: apiKey,
    project_id: projectId,
    version: VERSION,
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
        ip: koaContext.request.ip,
        url: getRequestUrl(koaContext.request),
        user_agent: koaContext.request.header["user-agent"],
        method: koaContext.request.method,
        headers: koaContext.request.headers,
        body: maskedRequestPayload !== undefined ? maskedRequestPayload : null,
      },
      response: {
        headers: responseHeaders,
        code: koaContext.response.status,
        size: koaContext.response.length || null,
        load_time: getRequestDuration(requestStartTime),
        body: maskedResponseBody !== undefined ? maskedResponseBody : null,
      },
      errors: errors,
    },
  };

  return dataToSend;
};

function sendExpressPayloadToTreblle(
  req,
  res,
  { apiKey, projectId, requestStartTime, error, fieldsToMaskMap, showErrors }
) {
  let trebllePayload = generateTrebllePayload(req, res, {
    apiKey,
    projectId,
    requestStartTime,
    error,
    fieldsToMaskMap,
  });

  sendPayloadToTreblleApi({ apiKey, trebllePayload, showErrors });
}

function sendKoaPayloadToTreblle(
  koaContext,
  { apiKey, projectId, requestStartTime, fieldsToMaskMap, showErrors, error }
) {
  let trebllePayload = generateKoaTrebllePayload(koaContext, {
    apiKey,
    projectId,
    requestStartTime,
    error,
    fieldsToMaskMap,
  });

  sendPayloadToTreblleApi({ apiKey, trebllePayload, showErrors });
}

function sendPayloadToTreblleApi({ apiKey, trebllePayload, showErrors }) {
  fetch("https://rocknrolla.treblle.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(trebllePayload),
  })
  .then(response => {
    if (showErrors && response.ok === false) {
      logTreblleResponseError(response)
    }
  }, error => {
    if (showErrors) {
      logRequestFailed(error)
    }
  });
}

async function logTreblleResponseError(response) {
  try {
    const responseBody = await response.json();
    logError(response, responseBody);
    return;
  } catch (_error) {
    // ignore _error here, it means the response wasn't JSON
  }

  try {
    const responseBody = await response.text();
    logError(response, responseBody);
    return;
  } catch (_error) {
    // ignore _error here, it means the response wasn't text
  }

  logError(response);
}

function logError(response, responseBody) {
  console.log(
    `[error] Sending data to Treblle failed - status: ${response.statusText} (${response.status})`,
    responseBody
  );
}

function logRequestFailed(error) {
  console.error(
    "[error] Sending data to Treblle failed (it's possibly a network error)",
    error
  );
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

function getRequestUrl(req) {
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  return fullUrl;
}

function getPayload(payload) {
  if (typeof payload === "object") return payload;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch (error) {
      // if we can't parse it we'll just return null
      return null;
    }
  }
}

module.exports = {
  sendExpressPayloadToTreblle,
  sendKoaPayloadToTreblle,
};
