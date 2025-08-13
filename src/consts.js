const ContentType = Object.freeze({
  ApplicationFormData: "application/x-www-form-urlencoded",
  MultipartFormData: "multipart/form-data",
  Json: "application/json",
  Text: "text/plain",
});

const DefaultBlockedPaths = Object.freeze([
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'manifest.json',
  'sw.js',
  'service-worker.js',
  '.well-known',
  'apple-touch-icon',
  'browserconfig.xml',
  'crossdomain.xml',
  'ads.txt',
]);

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
  ContentType,
  DefaultBlockedPaths,
  DefaultBlockedPatterns,
};
