import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// Import the Index component directly from the route file
// We re-export just the page component to avoid TanStack Start SSR dependencies
import { IndexPage } from "./IndexPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IndexPage />
  </StrictMode>
);
