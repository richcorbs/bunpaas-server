import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { promises as fs } from "fs";
import path from "path";

const PORT = 7099;
const TEST_DATA_DIR = `/tmp/paas-test-${process.pid}`;
const TEST_HOST = "test-site.localhost";
const TEST_HOST_INTERNAL = "test-site.richcorbs.com";

let serverProc;

async function request(path, options = {}) {
  const { method = "GET", headers = {}, body, host = TEST_HOST, redirect } = options;
  const url = `http://localhost:${PORT}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Host: host, ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect,
  });
  return res;
}

beforeAll(async () => {
  // Create test fixtures
  const siteDir = `${TEST_DATA_DIR}/sites/${TEST_HOST_INTERNAL}/current`;
  const functionsDir = `${siteDir}/_functions`;
  const dynamicDir = `${functionsDir}/users/[id]`;

  await fs.mkdir(dynamicDir, { recursive: true });
  await fs.mkdir(`${TEST_DATA_DIR}/logs`, { recursive: true });
  await fs.mkdir(`${siteDir}/docs`, { recursive: true });

  // Create password hash
  const passHash = await Bun.password.hash("secret", { algorithm: "bcrypt", cost: 4 });

  // sites.json
  await fs.writeFile(`${TEST_DATA_DIR}/sites.json`, JSON.stringify({
    sites: {
      [TEST_HOST_INTERNAL]: {
        enabled: true,
        deployKey: "dk_test123",
        env: { ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: passHash, TEST_VAR: "hello" },
      },
      "disabled-site.richcorbs.com": {
        enabled: false,
        deployKey: "dk_disabled",
        env: {},
      },
      "auth-site.richcorbs.com": {
        enabled: true,
        deployKey: "dk_auth",
        env: { ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: passHash },
      },
    },
  }));

  // site.json
  await fs.writeFile(`${siteDir}/site.json`, JSON.stringify({
    cors: { origins: ["http://allowed.com"], credentials: true },
    cacheControl: "public, max-age=7200",
  }));

  // Auth site
  const authSiteDir = `${TEST_DATA_DIR}/sites/auth-site.richcorbs.com/current`;
  await fs.mkdir(authSiteDir, { recursive: true });
  await fs.writeFile(`${authSiteDir}/site.json`, JSON.stringify({ auth: "basic" }));
  await fs.writeFile(`${authSiteDir}/index.html`, "<h1>Protected</h1>");

  // Static files
  await fs.writeFile(`${siteDir}/index.html`, "<h1>Home</h1>");
  await fs.writeFile(`${siteDir}/about.html`, "<h1>About</h1>");
  await fs.writeFile(`${siteDir}/style.css`, "body { color: red; }");
  await fs.writeFile(`${siteDir}/docs/index.html`, "<h1>Docs</h1>");
  await fs.writeFile(`${siteDir}/.env`, "SECRET=bad");

  // Functions
  await fs.writeFile(`${functionsDir}/hello.js`, `
export function get(req) {
  return { body: { message: "Hello", env: req.env.TEST_VAR } };
}
export function post(req) {
  return { body: { received: req.body } };
}
`);

  await fs.writeFile(`${functionsDir}/echo.js`, `
export default function(req) {
  return { body: { method: req.method, path: req.path, query: req.query } };
}
`);

  await fs.writeFile(`${functionsDir}/status.js`, `
export function get(req) {
  return { status: 201, body: { created: true }, headers: { "X-Custom": "header" } };
}
`);

  await fs.writeFile(`${dynamicDir}/index.js`, `
export function get(req) {
  return { body: { userId: req.params.id } };
}
`);

  // _redirects
  await fs.writeFile(`${siteDir}/_redirects`, `/old-page /new-page
/temp /somewhere 302
/blog/* /posts/:splat
`);

  // Custom 404
  await fs.writeFile(`${siteDir}/404.html`, "<h1>Custom 404</h1>");

  // Start server
  const scriptDir = path.resolve(import.meta.dir, "..");
  serverProc = spawn({
    cmd: ["bun", `${scriptDir}/server.js`],
    env: {
      ...process.env,
      NODE_ENV: "development",
      RICHHOST_DATA_DIR: TEST_DATA_DIR,
      RICHHOST_PORT: String(PORT),
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  // Wait for server
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      if (res.ok) break;
    } catch {}
    await Bun.sleep(100);
  }
});

afterAll(async () => {
  serverProc?.kill();
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

describe("Health Check", () => {
  test("returns 200", async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    expect(res.status).toBe(200);
  });

  test("contains status ok", async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("contains runtime:bun", async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    const body = await res.json();
    expect(body.runtime).toBe("bun");
  });
});

describe("Static Files", () => {
  test("serves index.html at root", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
  });

  test("serves CSS with correct content-type", async () => {
    const res = await request("/style.css");
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  test("serves directory index.html", async () => {
    const res = await request("/docs");
    expect(res.status).toBe(200);
  });

  test("serves pretty URLs", async () => {
    const res = await request("/about");
    const body = await res.text();
    expect(body).toContain("About");
  });

  test("respects cache-control from site.json", async () => {
    const res = await request("/style.css");
    expect(res.headers.get("cache-control")).toBe("public, max-age=7200");
  });

  test("returns 404 for missing files", async () => {
    const res = await request("/nonexistent.html");
    expect(res.status).toBe(404);
  });

  test("blocks /_functions path", async () => {
    const res = await request("/_functions/hello.js");
    expect(res.status).toBe(404);
  });

  test("blocks /site.json path", async () => {
    const res = await request("/site.json");
    expect(res.status).toBe(404);
  });

  test("blocks /.env path", async () => {
    const res = await request("/.env");
    expect(res.status).toBe(404);
  });
});

describe("Functions", () => {
  test("handles GET request", async () => {
    const res = await request("/hello");
    const body = await res.json();
    expect(body.message).toBe("Hello");
  });

  test("passes env to function", async () => {
    const res = await request("/hello");
    const body = await res.json();
    expect(body.env).toBe("hello");
  });

  test("handles POST with JSON body", async () => {
    const res = await request("/hello", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { name: "test" },
    });
    const body = await res.json();
    expect(body.received.name).toBe("test");
  });

  test("handles default export for any method", async () => {
    const res = await request("/echo?foo=bar", { method: "PUT" });
    const body = await res.json();
    expect(body.method).toBe("PUT");
  });

  test("passes query params", async () => {
    const res = await request("/echo?foo=bar", { method: "PUT" });
    const body = await res.json();
    expect(body.query.foo).toBe("bar");
  });

  test("handles dynamic route params", async () => {
    const res = await request("/users/123");
    const body = await res.json();
    expect(body.userId).toBe("123");
  });

  test("respects custom status code", async () => {
    const res = await request("/status");
    expect(res.status).toBe(201);
  });

  test("respects custom headers", async () => {
    const res = await request("/status");
    expect(res.headers.get("x-custom")).toBe("header");
  });
});

describe("CORS", () => {
  test("adds CORS header for allowed origin", async () => {
    const res = await request("/", { headers: { Origin: "http://allowed.com" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://allowed.com");
  });

  test("includes credentials header", async () => {
    const res = await request("/", { headers: { Origin: "http://allowed.com" } });
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("handles OPTIONS preflight", async () => {
    const res = await request("/", { method: "OPTIONS", headers: { Origin: "http://allowed.com" } });
    expect(res.status).toBe(204);
  });

  test("ignores disallowed origin", async () => {
    const res = await request("/", { headers: { Origin: "http://evil.com" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("Basic Auth", () => {
  test("returns 401 without credentials", async () => {
    const res = await request("/", { host: "auth-site.localhost" });
    expect(res.status).toBe(401);
  });

  test("includes WWW-Authenticate header", async () => {
    const res = await request("/", { host: "auth-site.localhost" });
    expect(res.headers.get("www-authenticate")).toBeTruthy();
  });

  test("rejects wrong password", async () => {
    const res = await request("/", {
      host: "auth-site.localhost",
      headers: { Authorization: "Basic " + btoa("admin:wrong") },
    });
    expect(res.status).toBe(401);
  });

  test("accepts correct credentials", async () => {
    const res = await request("/", {
      host: "auth-site.localhost",
      headers: { Authorization: "Basic " + btoa("admin:secret") },
    });
    expect(res.status).toBe(200);
  });
});

describe("Site Handling", () => {
  test("returns 404 for unknown hosts", async () => {
    const res = await request("/", { host: "unknown.localhost" });
    expect(res.status).toBe(404);
  });

  test("returns 503 for disabled sites", async () => {
    const res = await request("/", { host: "disabled-site.localhost" });
    expect(res.status).toBe(503);
  });
});

describe("Rate Limiting", () => {
  test("returns 429 when rate limited", async () => {
    let got429 = false;
    for (let i = 0; i < 101; i++) {
      const res = await fetch(`http://localhost:${PORT}/health`, {
        headers: { "X-Forwarded-For": `rate-test-${process.pid}` },
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });
});

describe("Trailing Slash Normalization", () => {
  test("redirects /about/ to /about", async () => {
    const res = await request("/about/", { redirect: "manual" });
    expect(res.status).toBe(301);
  });

  test("does not redirect root /", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
  });
});

describe("Security Headers", () => {
  test("includes X-Content-Type-Options", async () => {
    const res = await request("/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("includes X-Frame-Options", async () => {
    const res = await request("/");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  test("includes Referrer-Policy", async () => {
    const res = await request("/");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});

describe("Redirects", () => {
  test("redirects exact match", async () => {
    const res = await request("/old-page", { redirect: "manual" });
    expect(res.status).toBe(301);
  });

  test("redirects with custom status code", async () => {
    const res = await request("/temp", { redirect: "manual" });
    expect(res.status).toBe(302);
  });

  test("redirects wildcard with splat", async () => {
    const res = await request("/blog/my-post", { redirect: "manual" });
    expect(res.headers.get("location")).toContain("/posts/my-post");
  });
});

describe("Custom Error Pages", () => {
  test("serves custom 404.html", async () => {
    const res = await request("/nonexistent-page");
    const body = await res.text();
    expect(body).toContain("Custom 404");
  });
});
