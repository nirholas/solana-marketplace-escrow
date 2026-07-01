import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  // For GitHub Pages project sites the app is served under /<repo>/, so the
  // asset base must match. Set VITE_BASE=/solana-marketplace-escrow/ in that
  // build; defaults to '/' for local dev and root/custom-domain hosting.
  base: process.env.VITE_BASE || '/',
  // @solana/web3.js expects Node globals (Buffer, process) in the browser.
  plugins: [nodePolyfills({ globals: { Buffer: true, global: true, process: true } })],
  server: { port: 5173 },
});
