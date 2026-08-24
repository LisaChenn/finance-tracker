// Test-time env. Must run before any src/* import so that:
//  - db.ts opens an in-memory SQLite instead of the real per-env DB file
//  - plaid.ts's PLAID_SECRET check passes without needing server/.env
process.env.DATABASE_PATH = ":memory:";
process.env.PLAID_ENV = "sandbox";
process.env.PLAID_CLIENT_ID = "test_client_id";
process.env.PLAID_SANDBOX_SECRET = "test_sandbox_secret";
