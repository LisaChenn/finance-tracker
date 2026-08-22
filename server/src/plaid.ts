import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const PLAID_ENV = process.env.PLAID_ENV || "sandbox";

const SECRET_BY_ENV: Record<string, string | undefined> = {
  sandbox: process.env.PLAID_SANDBOX_SECRET,
  production: process.env.PLAID_PRODUCTION_SECRET,
};

const PLAID_SECRET = SECRET_BY_ENV[PLAID_ENV];

if (!PLAID_SECRET) {
  throw new Error(
    `Missing Plaid secret for PLAID_ENV="${PLAID_ENV}". ` +
      `Set PLAID_${PLAID_ENV.toUpperCase()}_SECRET in server/.env.`
  );
}

const configuration = new Configuration({
  basePath: PlaidEnvironments[PLAID_ENV as keyof typeof PlaidEnvironments],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);
