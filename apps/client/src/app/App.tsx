import { HomePage } from "../pages/HomePage";
import { ReviewSurfacePage } from "../pages/ReviewSurfacePage";

// Path-based view selection without a router dependency: the review surface lives
// at /pr/:owner/:repo/:number, everything else is the home page. Guarded for
// non-browser render (tests, SSR) where `window` is undefined - defaults to home.
function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

export function App() {
  return currentPath().startsWith("/pr/") ? (
    <ReviewSurfacePage />
  ) : (
    <HomePage />
  );
}
