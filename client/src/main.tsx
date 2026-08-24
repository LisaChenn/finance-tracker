import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { initSentry } from "./sentry";
import App from "./App";
import "./index.css";

initSentry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: 24, fontFamily: "system-ui" }}>
          <h2>Something went wrong.</h2>
          <p>Reload the page or check the console for details.</p>
        </div>
      }
    >
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
