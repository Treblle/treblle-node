const { generatePayload } = require("./generate-payload");
const { sendPayloadToTreblleApi } = require("../sender");

async function sendPayload(
  request,
  response,
  {
    sdkToken,
    apiKey,
    fieldsToMaskMap,
    debug = false,
    endpoint,
    requestExecutionTime,
    error,
  }
) {
  const trebllePayload = await generatePayload(request, response, {
    sdkToken,
    apiKey,
    fieldsToMaskMap,
    requestExecutionTime,
    error,
  });

  sendPayloadToTreblleApi({ apiKey: sdkToken, trebllePayload, debug, endpoint });
}

module.exports = {
  sendPayload,
};
