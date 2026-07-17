import { z } from "zod";

// The server wraps every successful response in this envelope via the global
// `ResponseInterceptor` (apps/server/src/common/interceptors/response.interceptor.ts):
// `{ success: true, data }`. Wrap a data schema to validate a full response body.
export const apiEnvelopeSchema = <Schema extends z.ZodTypeAny>(
  dataSchema: Schema,
): z.ZodType<ApiEnvelope<z.infer<Schema>>> =>
  // The runtime shape is exactly `{ success: true; data: <Schema> }`, but zod v4
  // makes the `data` key conditional on a generic schema's optionality and so
  // cannot prove it is present; assert the precise, known output type.
  z.object({
    success: z.literal(true),
    data: dataSchema,
  }) as unknown as z.ZodType<ApiEnvelope<z.infer<Schema>>>;

// Error bodies come from the global `HttpExceptionFilter`
// (apps/server/src/common/filters/http-exception.filter.ts):
// `{ success: false, statusCode, message }`.
export const apiErrorSchema = z.object({
  success: z.literal(false),
  statusCode: z.number().int(),
  message: z.string(),
});

export type ApiEnvelope<T> = {
  success: true;
  data: T;
};

export type ApiError = z.infer<typeof apiErrorSchema>;
