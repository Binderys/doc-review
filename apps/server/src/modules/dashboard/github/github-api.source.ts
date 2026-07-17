import type { PullRequestListItem } from "@doc-review/api-contracts";
import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  GitHubApiError,
  GitHubTimeoutError,
  GitHubTransportError,
} from "./github-api.error";
import {
  GitHubSource,
  type ChangedFile,
  type FileBlob,
  type GitHubFileStatus,
  type PullRequestMetadata,
} from "./github-source";

const GITHUB_API_BASE = "https://api.github.com";
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5_000;

interface RetryRuntime {
  sleep(delayMs: number): Promise<void>;
  now(): number;
  random(): number;
}

const defaultRetryRuntime: RetryRuntime = {
  sleep: (delayMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    }),
  now: Date.now,
  random: Math.random,
};

// Minimal projections of the GitHub REST payloads this source reads. Only the
// fields the app uses are declared; the responses carry many more.
interface GitHubPullPayload {
  number: number;
  title: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  user: { login: string } | null;
  created_at: string;
}

// The single-PR payload additionally carries the body and the PR's html_url, which
// the list projection omits.
interface GitHubPullDetailPayload extends GitHubPullPayload {
  body: string | null;
  html_url: string;
  merged: boolean;
}

interface GitHubFilePayload {
  filename: string;
  status: GitHubFileStatus;
  previous_filename?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPreResponseTimeout(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.name === "TimeoutError") {
    return true;
  }
  const cause = value.cause;
  return (
    isRecord(cause) &&
    (cause.code === "UND_ERR_CONNECT_TIMEOUT" ||
      cause.code === "UND_ERR_HEADERS_TIMEOUT")
  );
}

function jitteredBackoffDelayMs(attempt: number, random: () => number): number {
  const windowMs = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
    RETRY_MAX_DELAY_MS,
  );
  return random() * windowMs;
}

// Follow GitHub's cursor pagination via the `Link` response header. Returns the
// absolute URL of the `rel="next"` page, or null when the last page is reached.
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Validate a single pull-request element from a list or detail response. Both
// the collection projections and the detail parser build on this so every
// element GitHub returns is narrowed before it becomes contract data.
function parsePullPayload(value: unknown): GitHubPullPayload {
  if (!isRecord(value) || !isRecord(value.head) || !isRecord(value.base)) {
    throw new Error("GitHub pull request response has an invalid shape");
  }

  const user = value.user;
  let parsedUser: { login: string } | null;
  if (user === null) {
    parsedUser = null;
  } else if (isRecord(user) && typeof user.login === "string") {
    parsedUser = { login: user.login };
  } else {
    throw new Error("GitHub pull request response has an invalid shape");
  }
  if (
    typeof value.number !== "number" ||
    !Number.isInteger(value.number) ||
    typeof value.title !== "string" ||
    typeof value.head.ref !== "string" ||
    typeof value.head.sha !== "string" ||
    typeof value.base.ref !== "string" ||
    typeof value.created_at !== "string"
  ) {
    throw new Error("GitHub pull request response has an invalid shape");
  }

  return {
    number: value.number,
    title: value.title,
    head: { ref: value.head.ref, sha: value.head.sha },
    base: { ref: value.base.ref },
    user: parsedUser,
    created_at: value.created_at,
  };
}

function parsePullRequestDetail(value: unknown): GitHubPullDetailPayload {
  const base = parsePullPayload(value);
  // `parsePullPayload` proved `value` is a record; re-narrow for TS and check
  // the two detail-only fields the list projection omits.
  if (!isRecord(value)) {
    throw new Error("GitHub pull request response has an invalid shape");
  }
  const body = value.body;
  const htmlUrl = value.html_url;
  const merged = value.merged;
  if (
    (body !== null && typeof body !== "string") ||
    typeof htmlUrl !== "string" ||
    typeof merged !== "boolean"
  ) {
    throw new Error("GitHub pull request response has an invalid shape");
  }

  return { ...base, body, html_url: htmlUrl, merged };
}

// Validate a single changed-file element. `filename` and the object shape are
// checked; `status` is trusted as the union once confirmed to be a string,
// matching the existing projection's trust level.
function parseFilePayload(value: unknown): GitHubFilePayload {
  if (
    !isRecord(value) ||
    typeof value.filename !== "string" ||
    typeof value.status !== "string" ||
    (value.previous_filename !== undefined &&
      typeof value.previous_filename !== "string")
  ) {
    throw new Error("GitHub changed-file response has an invalid shape");
  }

  const parsed: GitHubFilePayload = {
    filename: value.filename,
    status: value.status as GitHubFileStatus,
  };
  if (typeof value.previous_filename === "string") {
    parsed.previous_filename = value.previous_filename;
  }
  return parsed;
}

// Best-effort parse of GitHub's JSON error body. Tolerates a non-JSON or empty
// body (returns no fields) rather than throwing a secondary error.
async function parseGitHubErrorBody(response: Response): Promise<{
  message?: string;
  code?: string;
  documentationUrl?: string;
}> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {};
  }
  if (!isRecord(body)) {
    return {};
  }

  const parsed: { message?: string; code?: string; documentationUrl?: string } =
    {};
  if (typeof body.message === "string") {
    parsed.message = body.message;
  }
  if (typeof body.documentation_url === "string") {
    parsed.documentationUrl = body.documentation_url;
  }
  const firstError = Array.isArray(body.errors) ? body.errors[0] : undefined;
  if (isRecord(firstError) && typeof firstError.code === "string") {
    parsed.code = firstError.code;
  }
  return parsed;
}

interface GitHubResponseMetadata {
  retryAfterSeconds?: number;
  rateLimitRemaining?: number;
  rateLimitResetEpochSeconds?: number;
  requestId?: string;
}

function parseNonNegativeHeader(
  response: Response,
  header: string,
): number | undefined {
  const value = response.headers.get(header);
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseRetryAfterSeconds(
  response: Response,
  now: () => number,
): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null) {
    return undefined;
  }

  const delaySeconds = Number(value);
  if (Number.isFinite(delaySeconds) && delaySeconds >= 0) {
    return delaySeconds;
  }

  const retryAtMs = Date.parse(value);
  if (!Number.isFinite(retryAtMs)) {
    return undefined;
  }
  return Math.max(0, retryAtMs - now()) / 1_000;
}

function parseGitHubResponseMetadata(
  response: Response,
  now: () => number,
): GitHubResponseMetadata {
  const requestId = response.headers.get("x-github-request-id");
  return {
    retryAfterSeconds: parseRetryAfterSeconds(response, now),
    rateLimitRemaining: parseNonNegativeHeader(
      response,
      "x-ratelimit-remaining",
    ),
    rateLimitResetEpochSeconds: parseNonNegativeHeader(
      response,
      "x-ratelimit-reset",
    ),
    requestId: requestId ?? undefined,
  };
}

function providerMinimumDelayMs(
  response: Response,
  metadata: GitHubResponseMetadata,
  now: () => number,
): number | undefined {
  if (metadata.retryAfterSeconds !== undefined) {
    return metadata.retryAfterSeconds * 1_000;
  }

  if (response.status !== 403 && response.status !== 429) {
    return undefined;
  }

  if (metadata.rateLimitRemaining === 0) {
    if (metadata.rateLimitResetEpochSeconds !== undefined) {
      return Math.max(0, metadata.rateLimitResetEpochSeconds * 1_000 - now());
    }
    return undefined;
  }

  // GitHub instructs clients to wait at least a minute for a secondary limit
  // without a usable Retry-After or reset signal. That exceeds this adapter's
  // five-second in-request delay budget and therefore fails without retrying.
  return response.status === 429 ? 60_000 : undefined;
}

/**
 * The real GitHub source: a thin wrapper over the Node 24 global `fetch` hitting
 * the GitHub REST API with the configured read-scope GitHub token. No Octokit, no
 * new dependency. `listOpenPullRequests` was first wired end to end in #6; the
 * remaining operations support the review surface.
 */
@Injectable()
export class GitHubApiSource extends GitHubSource {
  // The transport seam. Nest injects nothing (Optional), so the Node 24 global
  // `fetch` is used in production; tests pass a deterministic fake fetch.
  private readonly fetchFn: typeof fetch;
  private readonly retryRuntime: RetryRuntime;

  constructor(
    private readonly config: ConfigService,
    @Optional() fetchImpl?: typeof fetch,
    @Optional() retryRuntime?: RetryRuntime,
  ) {
    super();
    this.fetchFn = fetchImpl ?? globalThis.fetch;
    this.retryRuntime = retryRuntime ?? defaultRetryRuntime;
  }

  async listOpenPullRequests(repo: string): Promise<PullRequestListItem[]> {
    const payload = await this.requestJsonPaginated(
      `/repos/${repo}/pulls?state=open&per_page=100`,
    );

    return payload.map((item) => {
      const pull = parsePullPayload(item);
      return {
        number: pull.number,
        title: pull.title,
        branch: pull.head.ref,
        author: pull.user?.login ?? "unknown",
        createdAt: pull.created_at,
      };
    });
  }

  async getPullRequest(
    repo: string,
    prNumber: number,
  ): Promise<PullRequestMetadata> {
    const payload = parsePullRequestDetail(
      await this.requestJson(`/repos/${repo}/pulls/${prNumber}`),
    );

    return {
      number: payload.number,
      title: payload.title,
      description: payload.body ?? "",
      branch: payload.head.ref,
      headSha: payload.head.sha,
      baseBranch: payload.base.ref,
      merged: payload.merged,
      author: payload.user?.login ?? "unknown",
      createdAt: payload.created_at,
      htmlUrl: payload.html_url,
    };
  }

  async listChangedFiles(
    repo: string,
    prNumber: number,
  ): Promise<ChangedFile[]> {
    const payload = await this.requestJsonPaginated(
      `/repos/${repo}/pulls/${prNumber}/files?per_page=100`,
    );

    return payload.map((item) => {
      const file = parseFilePayload(item);
      const changed: ChangedFile = {
        path: file.filename,
        status: file.status,
      };
      if (file.previous_filename !== undefined) {
        changed.previousPath = file.previous_filename;
      }
      return changed;
    });
  }

  async fetchBlob(repo: string, ref: string, path: string): Promise<FileBlob> {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    // The raw media type returns the exact file bytes for files up to GitHub's
    // 100 MB Contents API limit; the JSON media type omits `content` above 1 MB.
    const response = await this.send(
      `/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
      "application/vnd.github.raw",
    );

    // Only a plain 200 carries the full file body. A 204/206 (empty/partial)
    // would otherwise decode to a successful empty or truncated blob.
    if (response.status !== 200) {
      throw new Error(
        `GitHub returned unexpected status ${response.status} for a raw blob request (${path}@${ref}); expected 200`,
      );
    }

    // A JSON body on a raw request is GitHub's error/directory shape, not file
    // bytes. Fail loudly rather than capturing it as a (potentially empty) blob.
    const contentType = response.headers.get("content-type") ?? "";
    if (/json/i.test(contentType)) {
      throw new Error(
        `GitHub returned a JSON response for a raw blob request (${path}@${ref}); expected raw file bytes`,
      );
    }

    return {
      path,
      ref,
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  }

  // A single JSON resource (metadata). Follows no pagination.
  private async requestJson(target: string): Promise<unknown> {
    const response = await this.send(target, "application/vnd.github+json");
    return response.json();
  }

  // A JSON collection, followed across every `Link` page in received order so
  // every item is returned exactly once with no reordering.
  private async requestJsonPaginated(target: string): Promise<unknown[]> {
    const items: unknown[] = [];
    let next: string | null = target;
    while (next !== null) {
      const response = await this.send(next, "application/vnd.github+json");
      const page: unknown = await response.json();
      if (!Array.isArray(page)) {
        throw new Error(
          `GitHub returned a non-array page during pagination of ${target}`,
        );
      }
      items.push(...page);
      next = parseNextLink(response.headers.get("link"));
    }
    return items;
  }

  // The single read-only transport point: GET only, no body, with the standard
  // GitHub headers and the per-call `Accept`. Accepts an absolute URL (a `Link`
  // next page) or a `/…` path resolved against the API base.
  private async send(target: string, accept: string): Promise<Response> {
    const token = this.config.get<string>("githubToken");
    const headers: Record<string, string> = {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "doc-review",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    // Resolve every target - relative `/…` path or absolute `Link` next URL -
    // against the API base, then pin its origin unconditionally. A `Link` URL is
    // attacker-influenceable (any scheme casing), so this must run before the
    // fetch so the bearer token is never sent off-origin.
    const url = new URL(target, GITHUB_API_BASE);
    if (url.origin !== new URL(GITHUB_API_BASE).origin) {
      throw new Error(
        `Refusing to follow a pagination link to a non-GitHub origin: ${url.origin}`,
      );
    }
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchFn(url, { headers });
      } catch (cause) {
        if (!isPreResponseTimeout(cause)) {
          throw new GitHubTransportError(
            `GitHub API request failed before a response (${target})`,
            cause,
          );
        }
        if (attempt === MAX_ATTEMPTS) {
          throw new GitHubTimeoutError(
            `GitHub API request timed out after ${MAX_ATTEMPTS} attempts (${target})`,
            cause,
          );
        }
        await this.retryRuntime.sleep(
          jitteredBackoffDelayMs(attempt, this.retryRuntime.random),
        );
        continue;
      }
      if (response.ok) {
        return response;
      }

      const details = await parseGitHubErrorBody(response);
      const metadata = parseGitHubResponseMetadata(
        response,
        this.retryRuntime.now,
      );
      const suffix = details.message ? `: ${details.message}` : "";
      const error = new GitHubApiError(
        `GitHub API request failed: ${response.status} ${response.statusText} (${target})${suffix}`,
        {
          status: response.status,
          code: details.code,
          documentationUrl: details.documentationUrl,
          ...metadata,
        },
      );
      const minimumDelayMs = providerMinimumDelayMs(
        response,
        metadata,
        this.retryRuntime.now,
      );
      const retryable =
        response.status === 408 ||
        response.status >= 500 ||
        minimumDelayMs !== undefined;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw error;
      }

      const delayMs = Math.max(
        minimumDelayMs ?? 0,
        jitteredBackoffDelayMs(attempt, this.retryRuntime.random),
      );
      if (delayMs > RETRY_MAX_DELAY_MS) {
        throw error;
      }
      await this.retryRuntime.sleep(delayMs);
    }
  }
}
