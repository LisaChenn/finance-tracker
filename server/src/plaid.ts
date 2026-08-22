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

// Extract only the safe fields from a Plaid error so we never accidentally log
// request headers (which contain the access token) or other sensitive context.
export function plaidErrorSummary(err: any): Record<string, unknown> {
  const data = err?.response?.data ?? {};
  return {
    status: err?.response?.status,
    error_code: data.error_code,
    error_type: data.error_type,
    error_message: data.error_message,
    request_id: data.request_id,
  };
}
