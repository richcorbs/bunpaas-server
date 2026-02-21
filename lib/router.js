import path from "path";
import crypto from "crypto";
import { getSiteConfig, getSiteByHost } from "./sites.js";
import { logRequest } from "./logs.js";
import { handleFunction } from "./functions.js";
import { serveStatic, serveError } from "./static.js";
import { handleRedirects } from "./redirects.js";
import { checkBasicAuth } from "./middleware/auth.js";

// Security headers (safe defaults that won't break sites)
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/**
 * Main request handler for Bun
 */
export async function handleRequest(req, options) {
  const { dataDir, clientIp = "unknown" } = options;
  const url = new URL(req.url);
  const startTime = Date.now();
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  // Extract host
  const host = url.hostname;

  // Get site
  const site = await getSiteByHost(dataDir, host);

  if (!site) {
    return addHeader(new Response("Site not found", { status: 404 }), "X-Request-Id", requestId);
  }

  if (!site.enabled) {
    return addHeader(new Response("Site is currently disabled", { status: 503 }), "X-Request-Id", requestId);
  }

  const sitePath = path.join(dataDir, "sites", host, "current");
  const siteConfig = await getSiteConfig(sitePath);

  // Trailing slash normalization: /foo/ -> /foo (except root)
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    const normalized = url.pathname.slice(0, -1) + url.search;
    return addHeader(Response.redirect(new URL(normalized, url.origin), 301), "X-Request-Id", requestId);
  }

  // Build context object
  const ctx = {
    url,
    host,
    site,
    sitePath,
    siteConfig: siteConfig || {},
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(req.headers),
  };

  // Basic auth check
  const auth = ctx.siteConfig.auth;
  if (auth) {
    const needsAuth = auth === "basic" ||
      (auth.type === "basic" && auth.paths?.some(p => ctx.path.startsWith(p)));
    if (needsAuth) {
      const authResult = await checkBasicAuth(req, site);
      if (authResult) {
        return addHeader(authResult, "X-Request-Id", requestId);
      }
    }
  }

  // Handle CORS preflight
  if (req.method === "OPTIONS" && ctx.siteConfig.cors) {
    return addHeader(handleCors(ctx.siteConfig.cors, req), "X-Request-Id", requestId);
  }

  // Check _redirects
  const redirect = await handleRedirects(sitePath, ctx.path);
  if (redirect) return addHeader(redirect, "X-Request-Id", requestId);

  let response;

  // Try static files first
  response = await serveStatic(ctx);

  // Fall back to function handlers
  if (!response) {
    response = await handleFunction(req, ctx);
  }

  // 404 if nothing handled it
  if (!response) {
    response = await serveError(sitePath, 404, "Not Found");
  }

  const durationMs = Date.now() - startTime;

  // Add security headers
  response = addSecurityHeaders(response);

  // Add CORS headers if configured
  if (ctx.siteConfig.cors) {
    response = addCorsHeaders(response, ctx.siteConfig.cors, req);
  }

  response = addHeader(response, "X-Request-Id", requestId);

  // Log request
  logRequest(host, {
    requestId,
    timestamp: new Date().toISOString(),
    method: req.method,
    path: ctx.path,
    status: response.status,
    durationMs,
    ip: clientIp,
  });

  return response;
}

function handleCors(corsConfig, req) {
  const origin = req.headers.get("origin");
  const headers = new Headers();

  if (origin && isOriginAllowed(origin, corsConfig)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", (corsConfig.methods || ["GET", "POST", "PUT", "DELETE"]).join(", "));
    headers.set("Access-Control-Allow-Headers", (corsConfig.headers || ["Content-Type", "Authorization", "X-API-Key"]).join(", "));
    headers.set("Access-Control-Max-Age", "86400");
    if (corsConfig.credentials) {
      headers.set("Access-Control-Allow-Credentials", "true");
    }
  }

  return new Response(null, { status: 204, headers });
}

function addCorsHeaders(response, corsConfig, req) {
  const origin = req.headers.get("origin");
  if (!origin || !isOriginAllowed(origin, corsConfig)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  if (corsConfig.credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isOriginAllowed(origin, corsConfig) {
  const allowed = corsConfig.origins || [];
  return allowed.includes("*") || allowed.includes(origin);
}

function addSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function addHeader(response, key, value) {
  const headers = new Headers(response.headers);
  headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
