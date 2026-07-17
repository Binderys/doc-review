import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { envFilePath } from "./env-file-path";

describe("envFilePath", () => {
  it("lists the per-app .env first and the root .env second", () => {
    // Pins the hop so it can't silently vanish: local override, then the
    // canonical root file two levels up (turbo cwd = apps/server).
    expect(envFilePath).toEqual([".env", "../../.env"]);
  });

  it("resolves a shared var to the per-app value (local file wins)", async () => {
    // Proves the precedence our ordering relies on: when the same key lives in
    // both files, ConfigModule takes the value from the file listed first.
    const dir = mkdtempSync(join(tmpdir(), "env-file-path-"));
    const local = join(dir, "local.env");
    const root = join(dir, "root.env");
    writeFileSync(local, "SHARED_ENV_VAR=local\n");
    writeFileSync(root, "SHARED_ENV_VAR=root\nROOT_ONLY_VAR=root\n");

    try {
      // Same [local, root] ordering as envFilePath; compiling loads the files.
      await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ envFilePath: [local, root] })],
      }).compile();

      // Local overrides root for the shared key...
      expect(process.env.SHARED_ENV_VAR).toBe("local");
      // ...while a root-only var still loads, so the root file is not ignored.
      expect(process.env.ROOT_ONLY_VAR).toBe("root");
    } finally {
      delete process.env.SHARED_ENV_VAR;
      delete process.env.ROOT_ONLY_VAR;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
