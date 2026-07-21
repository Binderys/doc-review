import type { ReactNode } from "react";
import { Masthead } from "./Masthead";
import { SiteFooter } from "./SiteFooter";

// The editorial frame every page wears: the binderys masthead (with an optional crumb),
// the centred reading frame, and the footer. Kept at the app level so the page components
// stay content-only - they render what lives between the masthead and the footer. The
// review journey widens the frame for its two facing pages.
export function AppShell({
  crumb,
  review = false,
  children,
}: {
  crumb?: string;
  review?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <div
        className={`app-shell__frame${review ? " app-shell__frame--review" : ""}`}
      >
        <Masthead crumb={crumb} />
        {children}
        <SiteFooter />
      </div>
    </div>
  );
}
