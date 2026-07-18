import {
  apiEnvelopeSchema,
  apiErrorSchema,
  z,
} from "@doc-review/api-contracts";
import { clientConfig } from "../index";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type ApiClientOptions = {
  baseUrl: string;
  // Injectable for tests; defaults to the global fetch in the browser.
  fetcher?: Fetcher;
};

type RequestOptions<Schema extends z.ZodTypeAny> = {
  schema: Schema;
};

type BodyMethod = "POST" | "PATCH";

export type ApiClient = {
  get<Schema extends z.ZodTypeAny>(
    path: string,
    options: RequestOptions<Schema>,
  ): Promise<z.infer<Schema>>;
  post<Schema extends z.ZodTypeAny>(
    path: string,
    body: unknown,
    options: RequestOptions<Schema>,
  ): Promise<z.infer<Schema>>;
  patch<Schema extends z.ZodTypeAny>(
    path: string,
    body: unknown,
    options: RequestOptions<Schema>,
  ): Promise<z.infer<Schema>>;
  delete<Schema extends z.ZodTypeAny>(
    path: string,
    options: RequestOptions<Schema>,
  ): Promise<z.infer<Schema>>;
};

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export const createApiClient = ({
  baseUrl,
  fetcher = fetch,
}: ApiClientOptions): ApiClient => {
  const request = async <Schema extends z.ZodTypeAny>(
    path: string,
    init: RequestInit,
    options: RequestOptions<Schema>,
  ): Promise<z.infer<Schema>> => {
    const response = await fetcher(resolveApiResourceUrl(path, baseUrl), {
      ...init,
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    });
    const body = await readJsonBody(response);

    if (!response.ok) {
      // Error responses are validated against the contract error schema; a body
      // that does not match falls back to the transport status.
      const parsedError = apiErrorSchema.safeParse(body);

      if (parsedError.success) {
        throw new ApiClientError(
          parsedError.data.message,
          parsedError.data.statusCode,
        );
      }

      throw new ApiClientError(response.statusText, response.status);
    }

    // The boundary parse: every success body must match the contract envelope
    // wrapping its data schema, or it is surfaced as an error and never trusted.
    const parsedEnvelope = apiEnvelopeSchema(options.schema).safeParse(body);

    if (!parsedEnvelope.success) {
      throw new ApiClientError(
        "Invalid API response",
        response.status,
        parsedEnvelope.error,
      );
    }

    return parsedEnvelope.data.data;
  };

  const requestWithBody = <Schema extends z.ZodTypeAny>(
    method: BodyMethod,
    path: string,
    body: unknown,
    options: RequestOptions<Schema>,
  ): Promise<z.infer<Schema>> =>
    request(
      path,
      {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      options,
    );

  return {
    get<Schema extends z.ZodTypeAny>(
      path: string,
      options: RequestOptions<Schema>,
    ) {
      return request(path, { method: "GET" }, options);
    },
    post<Schema extends z.ZodTypeAny>(
      path: string,
      body: unknown,
      options: RequestOptions<Schema>,
    ) {
      return requestWithBody("POST", path, body, options);
    },
    patch<Schema extends z.ZodTypeAny>(
      path: string,
      body: unknown,
      options: RequestOptions<Schema>,
    ) {
      return requestWithBody("PATCH", path, body, options);
    },
    delete<Schema extends z.ZodTypeAny>(
      path: string,
      options: RequestOptions<Schema>,
    ) {
      return request(path, { method: "DELETE" }, options);
    },
  };
};

const readJsonBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("Content-Type");

  if (!contentType?.toLowerCase().includes("application/json")) {
    return undefined;
  }

  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new ApiClientError("Invalid JSON response", response.status, error);
  }
};

// Server-owned non-JSON resources use the same configured origin as JSON requests.
export const resolveApiResourceUrl = (
  path: string,
  baseUrl = clientConfig.apiUrl,
): string => {
  const trimmedBaseUrl = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${trimmedBaseUrl}${normalizedPath}`;
};

// Default client bound to the app's configured API base URL.
export const apiClient = createApiClient({ baseUrl: clientConfig.apiUrl });
