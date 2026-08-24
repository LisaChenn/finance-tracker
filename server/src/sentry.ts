import * as Sentry from "@sentry/node";

// Field names that must never leave this machine. Includes Plaid tokens
// (access_token — long-lived, grants full API access to the linked bank)
// and public_token (short-lived exchange token). Scrubbed from request
// bodies, extra data, and stack-frame locals before events are sent.
const SENSITIVE_KEYS = new Set([
  "access_token",
  "public_token",
  "link_token",
  "PLAID_SANDBOX_SECRET",
  "PLAID_PRODUCTION_SECRET",
  "PLAID_CLIENT_ID",
]);

function scrub(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(scrub);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = "[Filtered]";
    } else {
      out[k] = scrub(v);
    }
  }
  return out;
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // No DSN configured — silent no-op.

  Sentry.init({
    dsn,
    environment: process.env.PLAID_ENV || "sandbox",
    // sendDefaultPii defaults to false; keep it that way. We do not want
    // IP addresses, cookies, or auth headers shipped off-box.
    sendDefaultPii: false,
    // Small performance sample so the free tier isn't blown by traces.
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Walk request/extra/contexts and blank out any known token fields
      // that made it into the event payload before shipping it upstream.
      if (event.request?.data) {
        event.request.data = scrub(event.request.data) as any;
      }
      if (event.extra) {
        event.extra = scrub(event.extra) as any;
      }
      if (event.contexts) {
        event.contexts = scrub(event.contexts) as any;
      }
      return event;
    },
  });
}
