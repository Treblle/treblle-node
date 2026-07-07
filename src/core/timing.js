/**
 * Creates a start marker for duration measurement.
 * @returns {number} high-resolution timestamp from performance.now()
 */
function createStartTime() {
  return performance.now();
}

/**
 * Calculates the request duration in milliseconds.
 *
 * @param {number} startTime marker from {@link createStartTime}
 * @returns {number} Duration in milliseconds
 */
function getRequestDuration(startTime) {
  if (typeof startTime !== "number") {
    return 0;
  }
  return Math.ceil(performance.now() - startTime);
}

module.exports = {
  createStartTime,
  getRequestDuration,
};
