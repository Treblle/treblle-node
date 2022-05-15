const stackTrace = require("stack-trace");

const version = require("../../package.json").version;
const { maskSensitiveValues } = require("../maskFields");
const { ContentType } = require("../consts");

async function generatePayload(
  request,
  response,
  { apiKey, projectId, additionalFieldsToMask, requestExecutionTime, error }
) {
  const errors = [];

  const requestBody = await parseRequest(request);
  const maskedRequestBody = requestBody
    ? maskSensitiveValues(requestBody, additionalFieldsToMask)
    : null;

  let maskedResponseBody = null;
  try {
    const responseBody = response ? await parseResponse(response) : null;
    maskedResponseBody = responseBody
      ? maskSensitiveValues(responseBody, additionalFieldsToMask)
      : null;
  } catch (err) {
    errors.push({
      source: "onShutdown",
      type: "INVALID_JSON",
      message: "Response in invalid JSON format",
      file: null,
      line: null,
    });
  }

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

  const requestHeaders = maskSensitiveValues(
    parseHeaders(request && request.headers),
    additionalFieldsToMask
  );
  const responseHeaders = maskSensitiveValues(
    parseHeaders(response && response.headers),
    additionalFieldsToMask
  );

  return {
    api_key: apiKey,
    project_id: projectId,
    version: version,
    sdk: "cloudflare",
    data: {
      server: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        os: {
          name: "Cloudflare Workers Runtime",
        },
        software: null,
        signature: null,
        protocol: request.cf.httpProtocol,
      },
      language: {
        name: "js",
      },
      request: {
        timestamp: new Date().toISOString().replace("T", " ").substr(0, 19),
        ip: request.headers.get("x-real-ip"),
        url: request.url,
        user_agent: request.headers.get("user-agent"),
        method: request.method,
        headers: requestHeaders,
        body: maskedRequestBody ? maskedRequestBody : null,
      },
      response: {
        headers: response ? responseHeaders : null,
        code: response ? response.status : 500,
        size: response ? getSize(maskedResponseBody) : 0,
        load_time:
          requestExecutionTime > 0 ? requestExecutionTime * 1000 : 1000,
        body: maskedResponseBody ? maskedResponseBody : null,
      },
      errors: errors,
    },
  };
}

const parseRequest = async (request) => {
  const requestContentType = request.headers.get("content-type");

  if (request.method === "GET") {
    const requestBody = {};
    for (let pair of new URL(request.url).searchParams.entries()) {
      requestBody[pair[0]] = pair[1];
    }
    return requestBody;
  } else if (
    requestContentType.includes(ContentType.MultipartFormData) ||
    requestContentType.includes(ContentType.ApplicationFormData)
  ) {
    const requestBody = {};
    const body = await request.formData();
    for (let pair of body.entries()) {
      requestBody[pair[0]] = pair[1];
    }
    return requestBody;
  } else if (requestContentType.includes(ContentType.Text)) {
    return request.text();
  } else if (requestContentType.includes(ContentType.Json)) {
    return request.json();
  } else {
    return null;
  }
};

const parseResponse = async (response) => {
  const responseContentType = response.headers.get("content-type");
  if (responseContentType.includes(ContentType.Text)) {
    return response.text();
  } else if (responseContentType.includes(ContentType.Json)) {
    return response.json();
  } else {
    const content = await response.text();
    if (content && content.length > 0) {
      try {
        return JSON.parse(content);
      } catch (e) {
        return content;
      }
    }
    return null;
  }
};

const parseHeaders = (headers) => {
  if (!headers) {
    return null;
  }
  const hdrs = {};
  for (let pair of headers.entries()) {
    hdrs[pair[0]] = pair[1];
  }
  return hdrs;
};

const getSize = (item) => {
  if (!item) {
    return 0;
  } else if (typeof item === "string") {
    return item.length;
  } else if (typeof item === "object") {
    return JSON.stringify(item).length;
  } else {
    return 0;
  }
};

module.exports = {
  generatePayload,
};
