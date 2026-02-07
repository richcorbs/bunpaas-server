/**
 * Check basic auth - returns Response if auth failed, null if successful
 */
export async function checkBasicAuth(req, site) {
  // Get credentials from site env vars
  const username = site.env?.ADMIN_USERNAME;
  const passwordHash = site.env?.ADMIN_PASSWORD_HASH;

  if (!username || !passwordHash) {
    return new Response("Auth not configured", { status: 500 });
  }

  // Parse Authorization header
  const authHeader = req.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return new Response("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
    });
  }

  // Decode credentials
  const base64Credentials = authHeader.slice(6);
  const credentials = Buffer.from(base64Credentials, "base64").toString("utf8");
  const [providedUsername, providedPassword] = credentials.split(":");

  // Verify username
  if (providedUsername !== username) {
    return new Response("Invalid credentials", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
    });
  }

  // Verify password using Bun's built-in bcrypt
  try {
    const valid = await Bun.password.verify(providedPassword, passwordHash);

    if (!valid) {
      return new Response("Invalid credentials", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
      });
    }

    // Auth successful
    return null;
  } catch (err) {
    console.error("Auth error:", err);
    return new Response("Auth error", { status: 500 });
  }
}

/**
 * Hash a password for storage (uses Bun's built-in bcrypt)
 */
export async function hashPassword(password) {
  return Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password, hash) {
  return Bun.password.verify(password, hash);
}
