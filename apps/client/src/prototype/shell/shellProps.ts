import type { ReviewSurfaceResponse } from "@doc-review/api-contracts";
import type { ShellTheme } from "./shellTheme";

// The props every shell variant receives. The data and the selection state live above
// the variant (in the host app), so only the rendering swaps when the variant changes -
// the sub-shape-A discipline, applied to a fixture-fed prototype surface.
export type ShellProps = {
  surface: ReviewSurfaceResponse;
  activePath: string;
  onSelect: (path: string) => void;
  theme: ShellTheme;
  onThemeChange: (theme: ShellTheme) => void;
};
