import { HomePage } from "../pages/HomePage";
import { ReviewShellPrototype } from "../pages/review-shell-prototype/ReviewShellPrototype";
import { ReviewSurfacePage } from "../pages/ReviewSurfacePage";

// Path-based view selection without a router dependency: the review surface lives
// at /pr/:owner/:repo/:number, everything else is the home page. Guarded for
// non-browser render (tests, SSR) where `window` is undefined - defaults to home.
function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

export function App() {
  const showShellPrototype =
    import.meta.env.DEV &&
    currentPath().startsWith("/pr/") &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("variant");

  if (showShellPrototype) return <ReviewShellPrototype />;

  return currentPath().startsWith("/pr/") ? (
    <ReviewSurfacePage />
  ) : (
    <HomePage />
  );
}
