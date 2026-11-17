import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

// Any change anywhere can move the dashboard numbers, so refresh them after every save.
const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({ onSuccess: () => queryClient.invalidateQueries({ queryKey: ["summary"] }) }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
