const { sendPayload } = require("./send-payload");
const { generateFieldsToMaskMap } = require("../maskFields");

const serviceWorkerTreblle = function ({
  apiKey,
  projectId,
  additionalFieldsToMask = [],
  showErrors = true,
}) {
  const fieldsToMaskMap = generateFieldsToMaskMap(additionalFieldsToMask);
  return (fetch) => {
    return (event) => {
      let requestStartTime;
      let respondWith;
      let requestClone;
      try {
        requestStartTime = Date.now();
        requestClone = event.request.clone();
        respondWith = event.respondWith.bind(event);
      } catch (err) {
        console.error("Error in Treblle middleware while cloning request", err);
      }
      event.respondWith = function (responsePromise) {
        respondWith(
          (async function () {
            let response;
            const requestEndTime = Date.now();
            try {
              response = await responsePromise;
              try {
                await sendPayload(requestClone, response.clone(), {
                  apiKey,
                  projectId,
                  fieldsToMaskMap,
                  showErrors,
                  requestExecutionTime: requestEndTime - requestStartTime,
                  error: null,
                });
              } catch (err) {
                // Just catch and log Treblle error - we do not want to crash app on Treblle's failure
                console.error(
                  "Error occurred when sending payload to Treblle, have you set appropriate headers for your content type?",
                  err
                );
              }
            } catch (err) {
              try {
                await sendPayload(requestClone, null, {
                  apiKey,
                  projectId,
                  fieldsToMaskMap,
                  showErrors,
                  requestExecutionTime: requestEndTime - requestStartTime,
                  error: err,
                });
              } catch (err) {
                // Just catch and log Treblle error - we do not want to crash app on Treblle's failure
                console.error(
                  "Error occurred when sending payload to Treblle.",
                  err
                );
              }
              throw err;
            }
            return response;
          })()
        );
      };
      let error;
      try {
        fetch(event);
      } catch (err) {
        const requestEndTime = Date.now();
        error = err;
        sendPayload(requestClone, null, {
          apiKey,
          projectId,
          fieldsToMaskMap,
          showErrors,
          requestExecutionTime: requestEndTime - requestStartTime,
          error,
        }).catch((err) => {
          // Just catch and log Treblle error - we do not want to crash app on Treblle's failure
          console.error("Error occurred when sending payload to Treblle", err);
        });
        throw error;
      }
    };
  };
};

module.exports = {
  serviceWorkerTreblle,
};
