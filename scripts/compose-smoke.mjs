import assert from "node:assert/strict";

const baseUrl = process.argv[2];
const phase = process.argv[3] ?? "initial";
const fixtureRoute = "/pr/acme/review-loop-fixture/38";

assert.match(baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
assert.match(phase, /^(initial|retained)$/);

const fetchResponse = async (path, accept) => {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { Accept: accept },
  });
  return response;
};

const sendJson = async (path, method, expectedStatus, body) => {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, expectedStatus);
  return response.json();
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

if (phase === "initial") {
  const reconcileBody = await sendJson(
    `${fixtureRoute}/review/reconcile`,
    "POST",
    200,
  );
  assert.equal(reconcileBody.data.number, 1);
  assert.equal(
    reconcileBody.data.headSha,
    "1234567890abcdef1234567890abcdef12345678",
  );

  const feedbackBody = await sendJson(`${fixtureRoute}/comments`, "POST", 201, {
    scope: "review",
    body: "Retain this review-level feedback across recreation.",
  });
  assert.equal(feedbackBody.data.roundNumber, 1);
  assert.equal(feedbackBody.data.resolved, false);
  assert.equal(
    feedbackBody.data.body,
    "Retain this review-level feedback across recreation.",
  );
} else {
  const retainedResponse = await fetchResponse(
    fixtureRoute,
    "application/json",
  );
  assert.equal(retainedResponse.status, 200);
  const retainedBody = await retainedResponse.json();
  assert.equal(retainedBody.data.currentRound.number, 1);
  assert.equal(retainedBody.data.currentRound.comments.length, 1);
  assert.equal(
    retainedBody.data.currentRound.comments[0].body,
    "Retain this review-level feedback across recreation.",
  );
  assert.equal(retainedBody.data.files[0].path, "deliverables/board-memo.md");
}
