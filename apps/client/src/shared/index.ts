const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export const clientConfig = {
  apiUrl,
} as const;
