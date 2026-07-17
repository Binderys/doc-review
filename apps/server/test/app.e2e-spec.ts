import type { INestApplication } from "@nestjs/common";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
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
    app = await createApp();
    await app.init();
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
    server = spawn(process.execPath, [resolve(__dirname, "../dist/main.js")], {
      env: {
        ...process.env,
        NODE_ENV: "test",
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

  it("boots the emitted production process and serves /health", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(HEALTH_RESPONSE);
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
