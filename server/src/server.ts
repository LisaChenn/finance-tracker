import "dotenv/config";
import { app } from "./app";
import { migrateFromJsonIfNeeded } from "./db";

const PORT = Number(process.env.PORT) || 8080;

migrateFromJsonIfNeeded();

// Bind to loopback only — this app has no auth layer and holds Plaid
// access tokens, so it must not be reachable from other machines on the
// local network. Override via HOST env var if you really need to (don't).
const HOST = process.env.HOST || "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`Finance tracker server listening on http://${HOST}:${PORT}`);
});
