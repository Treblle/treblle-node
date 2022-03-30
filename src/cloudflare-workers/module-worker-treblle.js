const { sendPayload } = require("./send-payload");

const moduleWorkerTreblle = function ({
  apiKey,
  projectId,
  additionalFieldsToMask = [],
  showErrors = true,
}) {
  return (fetch) => {
    return async (request, env, context) => {
      let response = null;
      let error = null;
      const requestStartTime = Date.now();
      try {
        response = await fetch(request, env, context);
      } catch (err) {
        error = err;
      }
      const requestEndTime = Date.now();
      try {
        await sendPayload(request.clone(), response ? response.clone() : null, {
          apiKey,
          projectId,
          additionalFieldsToMask,
          showErrors,
          requestExecutionTime: requestEndTime - requestStartTime,
          error,
        });
      } catch (err) {
        // Just catch and log Treblle error - we do not want to crash app on Treblle's failure
        console.error(
          "Error occurred when sending payload to Treblle. Have you set appropriate headers for your content type?",
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
