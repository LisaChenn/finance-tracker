import "dotenv/config";
// Sentry must init BEFORE any modules it auto-instruments (Express, http)
// are imported, so this comes before ./app.
import { initSentry } from "./sentry";
initSentry();

import * as Sentry from "@sentry/node";
import { app } from "./app";
import { migrateFromJsonIfNeeded } from "./db";

const PORT = Number(process.env.PORT) || 8080;

migrateFromJsonIfNeeded();

// Attach Sentry's Express error middleware after all routes are registered
// (they were registered in ./app on import above) but before .listen().
Sentry.setupExpressErrorHandler(app);

// Bind to loopback only — this app has no auth layer and holds Plaid
// access tokens, so it must not be reachable from other machines on the
// local network. Override via HOST env var if you really need to (don't).
const HOST = process.env.HOST || "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`Finance tracker server listening on http://${HOST}:${PORT}`);
});
