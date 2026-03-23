import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['storage', 'activeTab'],
    host_permissions: ['*://*.youtube.com/*'],
    externally_connectable: {
      matches: ['http://localhost:*/*'],
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    web_accessible_resources: [
      {
        resources: ['youtube-audio-hook.js', 'pitch-processor.js', 'wasm/*'],
        matches: ['*://*.youtube.com/*'],
      },
    ],
  },
});
