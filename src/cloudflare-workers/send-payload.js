const { generatePayload } = require("./generate-payload");
const { sendPayloadToTreblleApi } = require("../sender");

async function sendPayload(
  request,
  response,
  {
    sdkToken,
    apiKey,
    fieldsToMaskMap,
    showErrors = false,
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

  sendPayloadToTreblleApi({ apiKey: sdkToken, trebllePayload, showErrors });
}

module.exports = {
  sendPayload,
};
