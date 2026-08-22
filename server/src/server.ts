import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";
import { getItems, upsertItem, StoredItem } from "./store";

const PORT = Number(process.env.PORT) || 8080;
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

const plaidClient = new PlaidApi(configuration);

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/create_link_token", async (req: Request, res: Response) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: "local-user",
      },
      client_name: "Finance Dashboard",
      products: [Products.Transactions, Products.Investments],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    res.json({ link_token: response.data.link_token });
  } catch (error: any) {
    console.error("create_link_token error", error?.response?.data || error);
    res.status(500).json({ error: "Failed to create link token" });
  }
});

app.post("/api/exchange_public_token", async (req: Request, res: Response) => {
  const { public_token, institution_name } = req.body as {
    public_token?: string;
    institution_name?: string;
  };

  if (!public_token || !institution_name) {
    return res
      .status(400)
      .json({ error: "public_token and institution_name are required" });
  }

  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const item: StoredItem = {
      access_token: response.data.access_token,
      item_id: response.data.item_id,
      institution_name,
      linked_at: new Date().toISOString(),
    };

    upsertItem(item);
    res.json({ success: true, item_id: item.item_id });
  } catch (error: any) {
    console.error(
      "exchange_public_token error",
      error?.response?.data || error
    );
    res.status(500).json({ error: "Failed to exchange public token" });
  }
});

app.get("/api/accounts", async (req: Request, res: Response) => {
  const items = getItems();

  try {
    const groups = await Promise.all(
      items.map(async (item) => {
        try {
          const response = await plaidClient.accountsBalanceGet({
            access_token: item.access_token,
          });
          return {
            institution_name: item.institution_name,
            item_id: item.item_id,
            accounts: response.data.accounts,
          };
        } catch (error: any) {
          console.error(
            `accountsBalanceGet failed for ${item.institution_name}`,
            error?.response?.data || error
          );
          return {
            institution_name: item.institution_name,
            item_id: item.item_id,
            accounts: [],
            error: "Failed to fetch balances",
          };
        }
      })
    );

    res.json({ groups });
  } catch (error: any) {
    console.error("accounts error", error?.response?.data || error);
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
});

app.get("/api/transactions", async (req: Request, res: Response) => {
  const items = getItems();

  const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
  const start =
    (req.query.start as string) ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const groups = await Promise.all(
      items.map(async (item) => {
        try {
          const response = await plaidClient.transactionsGet({
            access_token: item.access_token,
            start_date: start,
            end_date: end,
          });
          return {
            institution_name: item.institution_name,
            item_id: item.item_id,
            transactions: response.data.transactions,
          };
        } catch (error: any) {
          console.error(
            `transactionsGet failed for ${item.institution_name}`,
            error?.response?.data || error
          );
          return {
            institution_name: item.institution_name,
            item_id: item.item_id,
            transactions: [],
            error: "Failed to fetch transactions",
          };
        }
      })
    );

    res.json({ start, end, groups });
  } catch (error: any) {
    console.error("transactions error", error?.response?.data || error);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

app.get("/api/items", (req: Request, res: Response) => {
  const items = getItems().map((item) => ({
    item_id: item.item_id,
    institution_name: item.institution_name,
    linked_at: item.linked_at,
  }));
  res.json({ items });
});

app.listen(PORT, () => {
  console.log(`Finance tracker server listening on http://localhost:${PORT}`);
});
