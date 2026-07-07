const DefaultBlockedPatterns = Object.freeze([
  /^\/favicon\.ico$/i,
  /^\/robots\.txt$/i,
  /^\/sitemap.*\.xml$/i,
  /^\/manifest\.json$/i,
  /^\/sw\.js$/i,
  /^\/service-worker\.js$/i,
  /^\/\.well-known\//i,
  /^\/apple-touch-icon/i,
  /^\/browserconfig\.xml$/i,
  /^\/crossdomain\.xml$/i,
  /^\/ads\.txt$/i,
  /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i,
  /^\/static\//i,
  /^\/assets\//i,
  /^\/public\//i,
  /^\/images\//i,
  /^\/css\//i,
  /^\/js\//i,
]);

module.exports = {
  DefaultBlockedPatterns,
};
