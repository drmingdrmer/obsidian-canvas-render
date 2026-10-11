const { defineConfig } = require('@playwright/test')

// Playwright lets Firefox send loopback requests through the proxy in
// http_proxy, and a local proxy can answer serve.sh's requests with 502.
// Stock Firefox keeps loopback requests direct, and so does this.
const firefoxUserPrefs = { 'network.proxy.allow_hijacking_localhost': false }

module.exports = defineConfig({
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs } } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
