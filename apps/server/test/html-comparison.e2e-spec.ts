import type { INestApplication } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../src/app.module";
import { FakeGitHubSource } from "../src/modules/dashboard/github/github-fake.source";
import {
  GitHubSource,
  type PullRequestMetadata,
} from "../src/modules/dashboard/github/github-source";
import { ReviewStateStore } from "../src/modules/review/review-state.store";

describe("authored HTML comparison browser egress", () => {
  let app: INestApplication | undefined;
  let controlServer: Server | undefined;
  let browserProcess: ChildProcess | undefined;
  let chromeProfile: string | undefined;

  afterEach(async () => {
    await stopProcess(browserProcess);
    await app?.close();
    if (controlServer?.listening) {
      await closeServer(controlServer);
    }
    if (chromeProfile) {
      await rm(chromeProfile, { force: true, recursive: true });
    }
  });

  it("issues zero document-controlled requests across passive resource vectors", async () => {
    const externalRequests: string[] = [];
    let signalComparisonLoaded: (() => void) | undefined;
    const comparisonLoaded = new Promise<void>((resolveLoaded) => {
      signalComparisonLoaded = resolveLoaded;
    });
    let comparisonUrl = "";
    controlServer = createServer((req, res) => {
      const requestUrl = req.url ?? "";
      if (requestUrl.startsWith("/egress/")) {
        externalRequests.push(requestUrl);
        res.writeHead(204).end();
        return;
      }
      if (requestUrl === "/comparison-loaded") {
        signalComparisonLoaded?.();
        res.writeHead(204).end();
        return;
      }
      if (requestUrl === "/blank-document") {
        res
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end("<!doctype html><body></body>");
        return;
      }
      if (requestUrl === "/baseline") {
        res
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(
            '<!doctype html><body><iframe title="Authored comparison" sandbox inert src="/blank-document"></iframe></body>',
          );
        return;
      }
      if (requestUrl === "/") {
        res
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(
            `<!doctype html><body><iframe title="Authored comparison" sandbox inert src="${comparisonUrl}" onload="requestAnimationFrame(()=>requestAnimationFrame(()=>fetch('/comparison-loaded',{method:'POST'})))"></iframe></body>`,
          );
        return;
      }
      res.writeHead(404).end();
    });
    await listen(controlServer);
    const controlOrigin = serverOrigin(controlServer);

    const owner = "acme";
    const repo = "html-egress-fixture";
    const slug = `${owner}/${repo}`;
    const number = 78;
    const path = "sources/tracked.html";
    const headSha = "7800000000000000000000000000000000000000";
    const rawHead = [
      "<!doctype html>",
      `<meta http-equiv="refresh" content="0;url=${controlOrigin}/egress/navigation">`,
      `<link rel="stylesheet" href="${controlOrigin}/egress/stylesheet.css">`,
      `<style>body { background-image: url("${controlOrigin}/egress/css-background.png"); } .inline-presentation { width: 96px; height: 48px; background: rgb(12 34 56); }</style>`,
      '<main class="inline-presentation" data-inline-structure="preserved"></main>',
      '<div style="position:absolute;left:-10000px">',
      `<img src="${controlOrigin}/egress/image.png" srcset="${controlOrigin}/egress/source-set-1.png 1x, ${controlOrigin}/egress/source-set-2.png 2x" alt="">`,
      `<iframe src="${controlOrigin}/egress/nested-frame.html"></iframe>`,
      `<object data="${controlOrigin}/egress/object.bin"></object>`,
      `<embed src="${controlOrigin}/egress/embed.bin">`,
      "</div>",
    ].join("");

    const fake = new FakeGitHubSource();
    const metadata: PullRequestMetadata = {
      number,
      title: "HTML egress fixture",
      description: "Browser-controlled request fixture",
      branch: "fix/html-egress",
      headSha,
      baseBranch: "main",
      merged: false,
      author: "browser-test",
      createdAt: "2026-07-16T00:00:00.000Z",
      htmlUrl: `https://github.com/${slug}/pull/${number}`,
    };
    fake.setPullRequest(slug, metadata);
    fake.setBlob(slug, headSha, {
      path,
      ref: headSha,
      bytes: Buffer.from(rawHead, "utf8"),
    });

    const testRoot = await mkdtemp(join(tmpdir(), "doc-review-chrome-"));
    chromeProfile = testRoot;
    const reviewState = new ReviewStateStore({
      get: (key: string): string | undefined =>
        key === "reviewStatePath"
          ? join(testRoot, "review-state.json")
          : undefined,
    } as unknown as ConfigService);
    await reviewState.reconcileRound(
      `${slug}#${number}`,
      headSha,
      async (anchor) => ({ anchor, drifted: false }),
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GitHubSource)
      .useValue(fake)
      .overrideProvider(ReviewStateStore)
      .useValue(reviewState)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    comparisonUrl = `${serverOrigin(app.getHttpServer())}/pr/${owner}/${repo}/${number}/raw?path=${encodeURIComponent(path)}&ref=${headSha}`;
    const comparisonResponse = await fetch(comparisonUrl);
    expect(comparisonResponse.status).toBe(200);
    expect(comparisonResponse.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; sandbox",
    );
    expect(Buffer.from(await comparisonResponse.arrayBuffer()).toString()).toBe(
      rawHead,
    );

    const comparisonScreenshotPath = join(chromeProfile, "comparison.png");
    browserProcess = runHeadlessChrome(
      `${controlOrigin}/`,
      join(chromeProfile, "comparison-profile"),
      comparisonScreenshotPath,
    );
    await Promise.all([
      withTimeout(
        screenshotWritten(browserProcess, comparisonScreenshotPath),
        10_000,
        "Headless Chrome did not capture the authored comparison",
      ),
      withTimeout(
        comparisonLoaded,
        10_000,
        "Headless Chrome did not load the authored comparison",
      ),
    ]);
    await stopProcess(browserProcess);
    browserProcess = undefined;

    expect(externalRequests).toEqual([]);

    const baselineScreenshotPath = join(chromeProfile, "baseline.png");
    browserProcess = runHeadlessChrome(
      `${controlOrigin}/baseline`,
      join(chromeProfile, "baseline-profile"),
      baselineScreenshotPath,
    );
    await withTimeout(
      screenshotWritten(browserProcess, baselineScreenshotPath),
      10_000,
      "Headless Chrome did not capture the blank comparison baseline",
    );
    await stopProcess(browserProcess);
    browserProcess = undefined;

    const [comparisonScreenshot, baselineScreenshot] = await Promise.all([
      readFile(comparisonScreenshotPath),
      readFile(baselineScreenshotPath),
    ]);
    expect(comparisonScreenshot.equals(baselineScreenshot)).toBe(false);
  }, 30_000);
});

function listen(server: Server): Promise<void> {
  return new Promise((resolveListening, rejectListening) => {
    server.once("error", rejectListening);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListening);
      resolveListening();
    });
  });
}

function serverOrigin(server: Server): string {
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("Expected the browser test server to be listening");
  }
  return `http://127.0.0.1:${address.port}`;
}

function findChrome(): string {
  const configured = process.env.CHROME_BIN;
  const candidates = [
    configured,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate): candidate is string => Boolean(candidate));

  const executable = candidates.find(
    (candidate) =>
      spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0,
  );
  if (!executable) {
    throw new Error(
      "A Chrome or Chromium executable is required for the HTML egress check",
    );
  }
  return executable;
}

function runHeadlessChrome(
  url: string,
  profile: string,
  screenshotPath: string,
): ChildProcess {
  return spawn(
    findChrome(),
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--window-size=800,600",
      `--screenshot=${screenshotPath}`,
      `--user-data-dir=${profile}`,
      url,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

function screenshotWritten(
  process: ChildProcess,
  screenshotPath: string,
): Promise<void> {
  return new Promise((resolveWritten, rejectWritten) => {
    const expected = `bytes written to file ${screenshotPath}`;
    let output = "";

    const onData = (chunk: Buffer | string): void => {
      output += chunk.toString();
      if (output.includes(expected)) {
        cleanup();
        resolveWritten();
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      rejectWritten(error);
    };
    const onExit = (code: number | null): void => {
      cleanup();
      rejectWritten(
        new Error(
          `Headless Chrome exited before its screenshot (code ${code})`,
        ),
      );
    };
    const cleanup = (): void => {
      process.stdout?.off("data", onData);
      process.stderr?.off("data", onData);
      process.off("error", onError);
      process.off("exit", onExit);
    };

    process.stdout?.on("data", onData);
    process.stderr?.on("data", onData);
    process.once("error", onError);
    process.once("exit", onExit);
  });
}

async function stopProcess(process: ChildProcess | undefined): Promise<void> {
  if (!process || process.exitCode !== null) {
    return;
  }
  process.kill("SIGTERM");
  await once(process, "exit");
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClosed, rejectClosed) => {
    server.close((error) => {
      if (error) {
        rejectClosed(error);
        return;
      }
      resolveClosed();
    });
    server.closeAllConnections();
  });
}

async function withTimeout<Result>(
  promise: Promise<Result>,
  timeoutMs: number,
  message: string,
): Promise<Result> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
