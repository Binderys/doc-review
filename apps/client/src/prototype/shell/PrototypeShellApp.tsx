import { useState } from "react";
import { shellFixture } from "./fixture";
import { ShellBar, type ShellOption } from "./ShellBar";
import { applyTheme, readStoredTheme, type ShellTheme } from "./shellTheme";
import type { ShellProps } from "./shellProps";
import { VariantLedger } from "./VariantLedger";
import { VariantQuire } from "./VariantQuire";
import { VariantSpine } from "./VariantSpine";

const OPTIONS: ShellOption[] = [
  { key: "A", name: "Codex spine" },
  { key: "B", name: "Masthead ledger" },
  { key: "C", name: "Split quire" },
];

function initialVariant(): string {
  const param = new URLSearchParams(window.location.search).get("variant");
  const key = (param ?? "").toUpperCase();
  return OPTIONS.some((option) => option.key === key) ? key : "A";
}

function renderVariant(key: string, props: ShellProps) {
  if (key === "B") return <VariantLedger {...props} />;
  if (key === "C") return <VariantQuire {...props} />;
  return <VariantSpine {...props} />;
}

// The host of the throwaway shell. It owns the single source of truth the variants read -
// the fixture surface, the active document, the theme - so switching shells swaps only the
// rendering, never the state. The variant key lives in the URL so a chosen shell is
// shareable and reload-stable.
export function PrototypeShellApp() {
  const [variant, setVariant] = useState(initialVariant);
  const [activePath, setActivePath] = useState(
    shellFixture.files[0]?.path ?? "",
  );
  const [theme, setTheme] = useState<ShellTheme>(readStoredTheme);

  const changeVariant = (key: string): void => {
    setVariant(key);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", key);
    window.history.replaceState(null, "", url);
  };

  const changeTheme = (next: ShellTheme): void => {
    setTheme(next);
    applyTheme(next);
  };

  const props: ShellProps = {
    surface: shellFixture,
    activePath,
    onSelect: setActivePath,
    theme,
    onThemeChange: changeTheme,
  };

  return (
    <>
      {renderVariant(variant, props)}
      <ShellBar options={OPTIONS} current={variant} onChange={changeVariant} />
    </>
  );
}
