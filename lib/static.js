import path from "path";

// Paths that should never be served as static files
const BLOCKED_PATTERNS = [
  /^\/_/,              // /_functions, /_lib, etc.
  /^\/site\.json$/,    // Site config
  /^\/package\.json$/, // Package info
  /^\/node_modules/,   // Dependencies
  /^\/\.bunpaas$/,     // Deploy secrets (shouldn't be here, but just in case)
  /^\/\.git/,          // Git directory
  /^\/\.env/,          // Environment files
];

// MIME types for common extensions
const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/**
 * Serve static files for a request - returns Response or null
 */
export async function serveStatic(ctx) {
  const { sitePath, path: reqPath, siteConfig } = ctx;
  const cacheControl = siteConfig?.cacheControl || "public, max-age=3600";

  // Block sensitive paths
  if (isBlockedPath(reqPath)) {
    return null;
  }

  // Try to serve the file
  const filePath = path.join(sitePath, reqPath);
  const response = await tryServeFile(filePath, cacheControl);
  if (response) return response;

  // Try index.html for directories
  const indexPath = path.join(filePath, "index.html");
  const indexResponse = await tryServeFile(indexPath, cacheControl);
  if (indexResponse) return indexResponse;

  // Pretty URLs: /about -> /about.html or /about/index.html
  if (!reqPath.endsWith("/") && !path.extname(reqPath)) {
    // Try /about/index.html
    const prettyIndexPath = path.join(sitePath, reqPath, "index.html");
    const prettyIndexResponse = await tryServeFile(prettyIndexPath, cacheControl);
    if (prettyIndexResponse) return prettyIndexResponse;

    // Try /about.html
    const htmlPath = path.join(sitePath, reqPath + ".html");
    const htmlResponse = await tryServeFile(htmlPath, cacheControl);
    if (htmlResponse) return htmlResponse;
  }

  return null;
}

async function tryServeFile(filePath, cacheControl) {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  // Check it's not a directory
  const stat = await file.stat?.();
  if (stat?.isDirectory?.()) {
    return null;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(file, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    },
  });
}

/**
 * Check if a path is blocked
 */
export function isBlockedPath(reqPath) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(reqPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Serve a custom error page if it exists, otherwise plain text
 */
export async function serveError(sitePath, status, defaultMessage) {
  const errorFile = Bun.file(path.join(sitePath, `${status}.html`));
  if (await errorFile.exists()) {
    return new Response(errorFile, {
      status,
      headers: { "Content-Type": "text/html" },
    });
  }
  return new Response(defaultMessage, { status });
}
