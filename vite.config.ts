import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Strict CSP is injected only into the production build; the Vite dev server
// needs websockets + inline scripts for HMR, which this policy forbids.
const CSP = [
  "default-src 'self'",
  "connect-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function injectCsp(): Plugin {
  return {
    name: "inject-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), injectCsp()],
  // No modulepreload polyfill: it embeds fetch() in the bundle, which both
  // trips the no-network CI check and would violate connect-src 'none'.
  build: { target: "es2020", modulePreload: { polyfill: false } },
});
