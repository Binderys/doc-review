import { afterEach, describe, expect, it, vi } from "vitest";

describe("clientConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses relative server URLs in production", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_API_URL", "http://localhost:3000");

    const { clientConfig } = await import("./index");

    expect(clientConfig.apiUrl).toBe("");
  });

  it("uses the configured split-origin server URL in development", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_API_URL", "http://localhost:4000");

    const { clientConfig } = await import("./index");

    expect(clientConfig.apiUrl).toBe("http://localhost:4000");
  });
});
