import { HomePage } from "../pages/HomePage";
import { ReviewShellPrototype } from "../pages/review-shell-prototype/ReviewShellPrototype";
import { ReviewSurfacePage } from "../pages/ReviewSurfacePage";
import { AppShell } from "./AppShell";

// Path-based view selection without a router dependency: the review surface lives
// at /pr/:owner/:repo/:number, everything else is the home page. Guarded for
// non-browser render (tests, SSR) where `window` is undefined - defaults to home.
function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

// The PR number carried by a review route, for the masthead crumb. The number rides
// the URL, so the crumb shows before the surface data loads. Null off the review path.
function reviewCrumb(pathname: string): string | undefined {
  const match = /^\/pr\/[^/]+\/[^/]+\/(\d+)$/.exec(pathname);
  return match ? `#${match[1]}` : undefined;
}

export function App() {
  const path = currentPath();

  const showShellPrototype =
    import.meta.env.DEV &&
    path.startsWith("/pr/") &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("variant");

  if (showShellPrototype) return <ReviewShellPrototype />;

  const isReview = path.startsWith("/pr/");

  return (
    <AppShell
      crumb={isReview ? reviewCrumb(path) : undefined}
      review={isReview}
    >
      {isReview ? <ReviewSurfacePage /> : <HomePage />}
    </AppShell>
  );
}
