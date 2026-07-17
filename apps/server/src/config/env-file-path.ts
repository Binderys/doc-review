// Turbo runs each app with cwd at its own directory (apps/server), so the
// canonical root `.env` is two levels up - `../../` encodes that layout, which
// the code alone cannot show. Order is deliberate: per-app `.env` first lets a
// fork override locally, the root `.env` second; ConfigModule gives precedence
// to the file listed first.
export const envFilePath = [".env", "../../.env"];
