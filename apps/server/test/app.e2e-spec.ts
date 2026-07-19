import type { INestApplication } from "@nestjs/common";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import request from "supertest";
import { createApp } from "../src/create-app";

const HEALTH_RESPONSE = {
  success: true,
  data: { status: "ok" },
};

// DB-less boot smoke: the server no longer wires any persistence, so this exercises
// the production assembly (createApp + globals) without Docker or Postgres. It boots
// via `app.init()` (no bound port) and asserts /health is served wrapped and CORS-enabled.
describe("server boot smoke", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      app = await createApp();
      await app.init();
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it("boots the production assembly and serves /health wrapped + CORS", async () => {
    const response = await request(app.getHttpServer())
      .get("/health")
      .set("Origin", "http://example.com")
      .expect(200);

    // Wrapped body proves the global ResponseInterceptor is applied...
    expect(response.body).toEqual(HEALTH_RESPONSE);
    // ...and a CORS header proves enableCors survived createApp().
    expect(response.headers["access-control-allow-origin"]).toBeDefined();
  });
});

describe("compiled server boot smoke", () => {
  let server: ChildProcess | undefined;
  let output = "";
  let port: number;

  beforeAll(async () => {
    const compiledEntry = pathToFileURL(
      resolve(__dirname, "../dist/main.js"),
    ).href;
    const rejectLiveGitHubFetch = `
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        const target = input instanceof Request ? input.url : input;
        if (new URL(target).origin === "https://api.github.com") {
          throw new Error("compiled boot smoke forbids live GitHub requests");
        }
        return nativeFetch(input, init);
      };
      void import(${JSON.stringify(compiledEntry)});
    `;
    server = spawn(process.execPath, ["--eval", rejectLiveGitHubFetch], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        GITHUB_TOKEN_ACME: "compiled-boot-acme-dummy-credential",
        GITHUB_TOKEN_OPERATOR_LAB:
          "compiled-boot-operator-lab-dummy-credential",
        WATCHED_REPOS: "acme/review-loop-fixture,operator-lab/archive-fixture",
        DOC_REVIEW_GITHUB_SOURCE: "compose-smoke",
        PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    server.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    server.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    port = await waitForServerReady(server, () => output);
  }, 10_000);

  afterAll(async () => {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
  });

  it("serves the SPA entry point and nested review navigation", async () => {
    const entryResponse = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { Accept: "text/html" },
    });
    const nestedResponse = await fetch(
      `http://127.0.0.1:${port}/pr/acme/review-loop-fixture/78`,
      { headers: { Accept: "text/html" } },
    );

    expect(entryResponse.status).toBe(200);
    expect(entryResponse.headers.get("content-type")).toContain("text/html");
    const entryHtml = await entryResponse.text();
    expect(entryHtml).toContain('<div id="root"></div>');
    const scriptPath = entryHtml.match(/<script[^>]+src="([^"]+)"/)?.[1];
    expect(scriptPath).toBeDefined();
    const scriptResponse = await fetch(
      `http://127.0.0.1:${port}${scriptPath ?? ""}`,
    );
    expect(scriptResponse.status).toBe(200);
    await expect(scriptResponse.text()).resolves.not.toContain(
      "http://localhost:3000",
    );
    expect(nestedResponse.status).toBe(200);
    expect(nestedResponse.headers.get("content-type")).toContain("text/html");
    await expect(nestedResponse.text()).resolves.toContain(
      '<div id="root"></div>',
    );
  });

  it("keeps server routes ahead of the SPA and production independent of CORS", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: {
        Accept: "text/html",
        Origin: "http://example.com",
      },
    });
    const reviewApiResponse = await fetch(
      `http://127.0.0.1:${port}/pr/acme/review-loop-fixture/not-a-number`,
      { headers: { Accept: "application/json" } },
    );
    const dashboardResponse = await fetch(
      `http://127.0.0.1:${port}/dashboard`,
      { headers: { Accept: "application/json" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(HEALTH_RESPONSE);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(reviewApiResponse.status).toBe(400);
    await expect(reviewApiResponse.json()).resolves.toMatchObject({
      success: false,
      statusCode: 400,
    });
    expect(dashboardResponse.status).toBe(200);
    await expect(dashboardResponse.json()).resolves.toMatchObject({
      success: true,
      data: {
        repos: [
          {
            repo: "acme/review-loop-fixture",
            pullRequests: [{ number: 38, title: "Board memo review loop" }],
          },
          {
            repo: "operator-lab/archive-fixture",
            pullRequests: [],
          },
        ],
      },
    });
  });

  it("exits before listening when a watched owner credential is missing", async () => {
    const configuredOwnerSecret = "CONFIGURED_OWNER_SECRET_SENTINEL";
    const legacySecret = "LEGACY_SECRET_SENTINEL";
    const otherOwnerSecret = "OTHER_OWNER_SECRET_SENTINEL";
    const failedServer = spawn(
      process.execPath,
      [resolve(__dirname, "../dist/main.js")],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          WATCHED_REPOS:
            "Binderys/board-review,binderys/legal-review,acme-legal/contracts",
          GITHUB_TOKEN_BINDERYS: configuredOwnerSecret,
          GITHUB_TOKEN_ACME_LEGAL: "",
          GITHUB_TOKEN: legacySecret,
          GITHUB_TOKEN_OTHER_OWNER: otherOwnerSecret,
          PORT: "0",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let failedOutput = "";
    let announcedReady = false;
    failedServer.stdout?.on("data", (chunk: Buffer) => {
      failedOutput += chunk.toString();
    });
    failedServer.stderr?.on("data", (chunk: Buffer) => {
      failedOutput += chunk.toString();
    });
    failedServer.on("message", () => {
      announcedReady = true;
    });

    const [exitCode] = (await once(failedServer, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];

    expect(exitCode).not.toBe(0);
    expect(announcedReady).toBe(false);
    expect(failedOutput).toMatch(/acme-legal.*GITHUB_TOKEN_ACME_LEGAL/i);
    expect(failedOutput).not.toContain(configuredOwnerSecret);
    expect(failedOutput).not.toContain(legacySecret);
    expect(failedOutput).not.toContain(otherOwnerSecret);
  });
});

async function waitForServerReady(
  server: ChildProcess,
  readOutput: () => string,
): Promise<number> {
  return new Promise<number>((resolveReady, rejectReady) => {
    const cleanup = () => {
      server.off("message", handleMessage);
      server.off("error", handleError);
      server.off("exit", handleExit);
    };
    const handleMessage = (message: unknown) => {
      if (isServerReadyMessage(message)) {
        cleanup();
        resolveReady(message.port);
      }
    };
    const handleError = (error: Error) => {
      cleanup();
      rejectReady(error);
    };
    const handleExit = (code: number | null) => {
      cleanup();
      rejectReady(
        new Error(`Compiled server exited with code ${code}:\n${readOutput()}`),
      );
    };

    if (server.exitCode !== null) {
      rejectReady(
        new Error(
          `Compiled server exited with code ${server.exitCode}:\n${readOutput()}`,
        ),
      );
      return;
    }
    server.on("message", handleMessage);
    server.once("error", handleError);
    server.once("exit", handleExit);
  });
}

function isServerReadyMessage(
  message: unknown,
): message is { type: "ready"; port: number } {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "ready" &&
    "port" in message &&
    typeof message.port === "number"
  );
}
