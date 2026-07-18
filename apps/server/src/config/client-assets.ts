import { join } from "node:path";

export const CLIENT_DIST_PATH: string = join(__dirname, "../../client/dist");
export const CLIENT_INDEX_PATH: string = join(CLIENT_DIST_PATH, "index.html");
