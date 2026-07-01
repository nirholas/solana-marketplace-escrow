#!/usr/bin/env node
import { createApp, configFromEnv } from './server.js';

const config = configFromEnv();
const port = Number(process.env.PORT ?? 4021);

createApp(config).listen(port, () => {
  process.stderr.write(
    `keyless-escrow-x402 listening on :${port} ` +
      `(rpc=${config.rpc}, paywall=${config.payTo ? 'on' : 'off'}, network=${config.network})\n`,
  );
});
