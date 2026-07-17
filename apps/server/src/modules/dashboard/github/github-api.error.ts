// A typed upstream error for the GitHub transport. Carries the HTTP status and,
// when GitHub's JSON error body provides them, the top-level documentation URL
// and the first `errors[].code`. Callers narrow on `instanceof GitHubApiError`
// to read the upstream status/code rather than parsing the message.
export class GitHubApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly documentationUrl?: string;
  readonly retryAfterSeconds?: number;
  readonly rateLimitRemaining?: number;
  readonly rateLimitResetEpochSeconds?: number;
  readonly requestId?: string;

  constructor(
    message: string,
    details: {
      status: number;
      code?: string;
      documentationUrl?: string;
      retryAfterSeconds?: number;
      rateLimitRemaining?: number;
      rateLimitResetEpochSeconds?: number;
      requestId?: string;
    },
  ) {
    super(message);
    this.name = "GitHubApiError";
    this.status = details.status;
    this.code = details.code;
    this.documentationUrl = details.documentationUrl;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.rateLimitRemaining = details.rateLimitRemaining;
    this.rateLimitResetEpochSeconds = details.rateLimitResetEpochSeconds;
    this.requestId = details.requestId;
  }
}

// A typed failure for the no-response case. Preserve the native error as the
// cause so diagnostics retain runtime-specific transport detail.
export class GitHubTransportError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "GitHubTransportError";
  }
}

// A timeout is the retryable transport subtype. It carries no HTTP status
// because GitHub never returned a response.
export class GitHubTimeoutError extends GitHubTransportError {
  constructor(message: string, cause: unknown) {
    super(message, cause);
    this.name = "GitHubTimeoutError";
  }
}
