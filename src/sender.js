const { maskSensitiveValues } = require("./maskFields");
const os = require("os");
const url = require("url");
const fetch = require("node-fetch");
const stackTrace = require("stack-trace");

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
  const responseHeaders = res.getHeaders();

  let errors = [];

  // We should be able to parse this, but you never know if users will try doing something weird...
  let responseBody
  try {
    let originalResponseBody = res.__treblle_body_response;
    // if it's not parsed, try parsing it
    if (typeof originalResponseBody === "string") {
      let parsedResponseBody = JSON.parse(originalResponseBody);
      responseBody = maskSensitiveValues(parsedResponseBody, fieldsToMaskMap)
    } else if (typeof originalResponseBody === "object") {
      responseBody = maskSensitiveValues(originalResponseBody, fieldsToMaskMap);
    }
  } catch {
    // if we can't parse the body we'll leave it empty and set an error
    errors.push({
      source: "onShutdown",
      type: "INVALID_JSON",
      message: "Invalid JSON format",
      file: null,
      line: null,
    })
  }

  const protocol = `${req.protocol.toUpperCase()}/${req.httpVersion}`;

  res.__treblle_body_response = null;

  if (error) {
    const trace = stackTrace.parse(error);

    errors.push([
      {
        source: "onException",
        type: "UNHANDLED_EXCEPTION",
        message: error.message,
        file: trace[0].getFileName(),
        line: trace[0].getLineNumber(),
      },
    ]);
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
  { apiKey, projectId, requestStartTime, error, fieldsToMaskMap, showErrors }
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

  logError(response)
}

function logError(response, responseBody) {
  console.log(`[error] Sending data to Treblle failed - status: ${response.statusText} (${response.status})`, responseBody);
}

function logRequestFailed(error) {
  console.error("[error] Sending data to Treblle failed (it's possibly a network error)", error);
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
  return url.format({
    protocol: req.protocol,
    host: req.get("host"),
    pathname: req.originalUrl,
  });
}

module.exports = {
  sendPayloadToTrebble
};
