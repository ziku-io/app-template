import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Link as RouterLink, Route, Routes } from "react-router"
import { LinkProvider } from "@ziku/ui"

import { App } from "./App"
import "./index.css"

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

// Design-system blocks render links through this, so their hrefs become
// client-side navigations instead of full page loads.
const Link = ({ href, ...props }: React.ComponentProps<"a"> & { href: string }) => (
  <RouterLink to={href} {...props} />
)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LinkProvider component={Link}>
          <Routes>
            <Route path="/*" element={<App />} />
          </Routes>
        </LinkProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)
