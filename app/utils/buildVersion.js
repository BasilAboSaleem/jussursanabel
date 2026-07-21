/**
 * Unique build id for cache busting. Render sets RENDER_GIT_COMMIT on each deploy.
 */
function getBuildVersion() {
  const raw =
    process.env.APP_BUILD_ID ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    "dev";
  return String(raw).slice(0, 12);
}

module.exports = { getBuildVersion };
