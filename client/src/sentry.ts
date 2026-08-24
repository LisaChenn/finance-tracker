import * as Sentry from "@sentry/react";

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return; // No DSN configured — silent no-op.

  Sentry.init({
    dsn,
    // Keep off — this is a personal finance app, IP/cookies shouldn't ship.
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    // Report Vite-served page errors from localhost only. Anything else
    // (extension errors, injected scripts) gets dropped.
    allowUrls: [/localhost/, /127\.0\.0\.1/],
  });
}
