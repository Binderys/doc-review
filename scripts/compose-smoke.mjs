import assert from "node:assert/strict";

const baseUrl = process.argv[2];

assert.match(baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);

const fetchResponse = async (path, accept) => {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { Accept: accept },
  });
  return response;
};

const healthResponse = await fetchResponse("/health", "text/html");
assert.equal(healthResponse.status, 200);
assert.match(
  healthResponse.headers.get("content-type") ?? "",
  /application\/json/,
);
assert.deepEqual(await healthResponse.json(), {
  success: true,
  data: { status: "ok" },
});

const entryResponse = await fetchResponse("/", "text/html");
assert.equal(entryResponse.status, 200);
assert.match(entryResponse.headers.get("content-type") ?? "", /text\/html/);
const entryHtml = await entryResponse.text();
assert.match(entryHtml, /<div id="root"><\/div>/);

const nestedResponse = await fetchResponse("/pr/acme/reports/78", "text/html");
assert.equal(nestedResponse.status, 200);
assert.match(nestedResponse.headers.get("content-type") ?? "", /text\/html/);
assert.match(await nestedResponse.text(), /<div id="root"><\/div>/);

const serverRouteResponse = await fetchResponse(
  "/pr/acme/reports/not-a-number",
  "application/json",
);
assert.equal(serverRouteResponse.status, 400);
assert.match(
  serverRouteResponse.headers.get("content-type") ?? "",
  /application\/json/,
);
assert.deepEqual(await serverRouteResponse.json(), {
  success: false,
  statusCode: 400,
  message: "Validation failed (numeric string is expected)",
});

const scriptPaths = Array.from(
  entryHtml.matchAll(/<script[^>]+src="([^"]+)"/g),
  (match) => match[1],
);
assert.ok(scriptPaths.length > 0, "SPA entry point has no scripts");

const scriptBodies = await Promise.all(
  scriptPaths.map(async (scriptPath) => {
    const scriptUrl = new URL(scriptPath, entryResponse.url);
    assert.equal(scriptUrl.origin, new URL(baseUrl).origin);
    const scriptResponse = await fetch(scriptUrl);
    assert.equal(scriptResponse.status, 200);
    return scriptResponse.text();
  }),
);

const absoluteUrls = Array.from(
  new Set(
    scriptBodies.flatMap(
      (body) => body.match(/https?:\/\/(?:\[[^\]]+\]|[^"'`\s<>)\\]+)/g) ?? [],
    ),
  ),
);
const allowedLibraryUrlPrefixes = [
  "http://[${",
  "http://json-schema.org/",
  "http://www.w3.org/",
  "https://json-schema.org/",
  "https://react.dev/",
];
const unexpectedAbsoluteUrls = absoluteUrls.filter(
  (url) => !allowedLibraryUrlPrefixes.some((prefix) => url.startsWith(prefix)),
);
assert.deepEqual(
  unexpectedAbsoluteUrls,
  [],
  "production SPA contains an absolute URL outside its library namespaces",
);
