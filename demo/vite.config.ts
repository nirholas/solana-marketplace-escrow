import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  // @solana/web3.js expects Node globals (Buffer, process) in the browser.
  plugins: [nodePolyfills({ globals: { Buffer: true, global: true, process: true } })],
  server: { port: 5173 },
});
