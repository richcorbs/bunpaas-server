import path from "path";
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

// Caches
const siteConfigCache = new Map();

/**
 * Main request handler for Bun
 */
export async function handleRequest(req, options) {
  const { dataDir } = options;
  const url = new URL(req.url);
  const startTime = Date.now();

  // Extract host
  const host = url.hostname;

  // Get site
  const site = await getSiteByHost(dataDir, host);

  if (!site) {
    return new Response("Site not found", { status: 404 });
  }

  if (!site.enabled) {
    return new Response("Site is currently disabled", { status: 503 });
  }

  const sitePath = path.join(dataDir, "sites", host, "current");
  const siteConfig = await getSiteConfig(sitePath);

  // Trailing slash normalization: /foo/ -> /foo (except root)
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    const normalized = url.pathname.slice(0, -1) + url.search;
    return Response.redirect(new URL(normalized, url.origin), 301);
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

  // Basic auth check (skip for /deploy)
  if (ctx.siteConfig.auth === "basic" && ctx.path !== "/deploy") {
    const authResult = await checkBasicAuth(req, site);
    if (authResult) return authResult; // Returns 401 response if failed
  }

  // Handle CORS preflight
  if (req.method === "OPTIONS" && ctx.siteConfig.cors) {
    return handleCors(ctx.siteConfig.cors, req);
  }

  // Check _redirects
  const redirect = await handleRedirects(sitePath, ctx.path);
  if (redirect) return redirect;

  let response;

  // Try function handler first
  response = await handleFunction(req, ctx);

  // Fall back to static files
  if (!response) {
    response = await serveStatic(ctx);
  }

  // 404 if nothing handled it
  if (!response) {
    response = await serveError(sitePath, 404, "Not Found");
  }

  // Add security headers
  response = addSecurityHeaders(response);

  // Add CORS headers if configured
  if (ctx.siteConfig.cors) {
    response = addCorsHeaders(response, ctx.siteConfig.cors, req);
  }

  // Log request
  logRequest(host, {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: ctx.path,
    status: response.status,
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
  return allowed.includes("*") || allowed.includes(origin) || allowed.length === 0;
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
