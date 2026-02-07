import path from "path";

/**
 * Load and parse _redirects file for a site
 * Format: /from /to [status]
 * Example:
 *   /old /new 301
 *   /blog/* /posts/:splat
 */
async function loadRedirects(sitePath) {
  const file = Bun.file(path.join(sitePath, "_redirects"));
  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
  const redirects = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const [from, to, statusStr] = parts;
    const status = parseInt(statusStr) || 301;

    redirects.push({ from, to, status });
  }

  return redirects;
}

/**
 * Check if a path matches a redirect rule and return redirect response if so
 */
export async function handleRedirects(sitePath, reqPath) {
  const redirects = await loadRedirects(sitePath);

  for (const { from, to, status } of redirects) {
    // Exact match
    if (from === reqPath) {
      return Response.redirect(to, status);
    }

    // Wildcard match: /blog/* matches /blog/anything
    if (from.endsWith("/*")) {
      const prefix = from.slice(0, -2);
      if (reqPath.startsWith(prefix + "/") || reqPath === prefix) {
        const splat = reqPath.slice(prefix.length + 1);
        const destination = to.replace(":splat", splat);
        return Response.redirect(destination, status);
      }
    }
  }

  return null;
}
