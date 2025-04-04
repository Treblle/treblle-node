const { sendPayload } = require("./send-payload");
const { generateFieldsToMaskMap } = require("../maskFields");

const moduleWorkerTreblle = function ({
  apiKey,
  projectId,
  additionalFieldsToMask = [],
  showErrors = false,
}) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);
  return (fetch) => {
    return async (request, env, context) => {
      let response = null;
      let error = null;
      let requestClone;
      const requestStartTime = Date.now();
      try {
        requestClone = request.clone();
      } catch (err) {
        console.error("Error in Treblle middleware while cloning request", err);
      }
      try {
        response = await fetch(request, env, context);
      } catch (err) {
        error = err;
      }
      const requestEndTime = Date.now();
      try {
        await sendPayload(requestClone, response ? response.clone() : null, {
          apiKey,
          projectId,
          fieldsToMaskMap,
          showErrors,
          requestExecutionTime: requestEndTime - requestStartTime,
          error,
        });
      } catch (err) {
        // Just catch and log Treblle error - we do not want to crash app on Treblle's failure
        console.error(
          "Error occurred when sending payload to Treblle, have you set appropriate headers for your content type?",
          err
        );
      }

      if (error) {
        // Rethrow application errors
        throw error;
      }
      return response;
    };
  };
};

module.exports = {
  moduleWorkerTreblle,
};
