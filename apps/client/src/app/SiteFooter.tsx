import { Mark } from "./Mark";

// The footer carries the seam mark and the rendering promise the product makes:
// every document is rendered on the server, and confidential content never leaves
// the network (CONTEXT "Rendering").
export function SiteFooter() {
  return (
    <footer className="app-shell__foot">
      <Mark className="app-shell__foot-mark" />
      <span>
        Rendered on the server; confidential content never leaves the network.
      </span>
    </footer>
  );
}
