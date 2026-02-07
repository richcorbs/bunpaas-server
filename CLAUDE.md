# BunPaaS Server - Claude Context

Lightweight Bun-based PaaS for hosting static sites with serverless functions. Zero npm dependencies.

## Architecture Overview

```
Caddy (:80/:443) → Bun.serve() (:7001) → Router → Functions/Static
                                              ↓
                                    /var/www/sites/{host}/current/
```

- **Caddy**: Reverse proxy, auto SSL via Let's Encrypt, on-demand TLS
- **Bun**: HTTP server, zero dependencies, native APIs
- **Multi-tenant**: Host-based routing, isolated site directories

## File Structure

```
bunpaas-server/
├── server.js          # Entry point, Bun.serve(), graceful shutdown
├── app.js             # Request handler factory, rate limiting, health check
├── lib/
│   ├── config.js      # DATA_DIR, isDev, PORT from env
│   ├── router.js      # Main dispatcher: auth → redirects → functions → static → 404
│   ├── static.js      # Static file serving, pretty URLs, blocked paths, error pages
│   ├── functions.js   # Serverless function loader, dynamic routes, timeouts
│   ├── redirects.js   # _redirects file parsing and matching
│   ├── sites.js       # sites.json management, site configs, caching
│   ├── logs.js        # Buffered request logging (10s flush, 20 logs/site)
│   └── middleware/
│       └── auth.js    # Basic auth with bcrypt (Bun native)
└── tests/
    └── paas.test.js   # Bun test suite
```

## Request Flow (router.js)

1. Extract host from request
2. Look up site in sites.json
3. If unknown host → 404
4. If disabled → 503
5. Trailing slash normalization (`/foo/` → `/foo`)
6. Basic auth check (if `site.json` has `"auth": "basic"`)
7. CORS preflight handling
8. Check `_redirects` file
9. Try function handler (`_functions/`)
10. Try static file
11. Serve custom error page or plain text 404
12. Add security headers
13. Add CORS headers
14. Log request

## Data Directory Structure

```
/var/www/
├── sites.json              # Global config: sites, deploy keys, env vars
├── logs/
│   └── {host}.json         # Per-site request logs (last 20)
└── sites/
    └── example.com/
        ├── current/        # Active deployment (symlink target)
        │   ├── index.html
        │   ├── site.json   # Per-site config (cors, auth, cacheControl, functionTimeout)
        │   ├── _redirects  # Redirect rules
        │   ├── 404.html    # Custom error page (optional)
        │   └── _functions/ # Serverless functions
        └── deploys/        # Deploy history
```

## Site Configuration (site.json)

```json
{
  "cors": {
    "origins": ["https://app.example.com"],
    "credentials": true
  },
  "auth": "basic",
  "cacheControl": "public, max-age=3600",
  "functionTimeout": 30000
}
```

## Serverless Functions

Location: `_functions/` directory

**Routing:**
- `/hello` → `_functions/hello.js` or `_functions/hello/index.js`
- `/users/123` → `_functions/users/[id].js` or `_functions/users/[id]/index.js`

**Handler signature:**
```js
// Named exports for specific methods
export function get(req) { return { body: { message: "Hello" } }; }
export function post(req) { return { body: { received: req.body } }; }

// Default export catches all methods
export default function(req) { return { body: { method: req.method } }; }
```

**Request object:**
```js
{
  method: "GET",
  path: "/hello",
  query: { foo: "bar" },
  headers: { ... },
  body: { ... },           // Parsed JSON, text, or Buffer
  params: { id: "123" },   // From dynamic routes
  env: { API_KEY: "..." }  // From sites.json env
}
```

**Response object:**
```js
{
  status: 200,             // Optional, defaults to 200
  headers: { ... },        // Optional
  body: object | string | Buffer | null
}
```

## Redirects (_redirects)

```
# Format: /from /to [status]
/old-page /new-page
/temp /somewhere 302
/blog/* /posts/:splat
```

- Default status: 301
- Wildcard: `/*` captures rest of path, `:splat` inserts it

## Security Headers (automatic)

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`

## Caching Strategy

- **sites.json**: In-memory, mtime check in dev, trusted in prod
- **site.json**: Per-site cache, mtime check in dev, cleared on deploy
- **Functions**: Module cache in prod, hot reload in dev
- **Redirects**: Read on each request (simple, file is tiny)

## Environment Variables

- `BUNPAAS_DATA_DIR` - Data directory (default: `/var/www`)
- `BUNPAAS_PORT` - Server port (default: `7001` dev, `443` prod)
- `NODE_ENV` - `development` enables dev features

## Testing

```bash
bun test
```

## Key Design Decisions

1. **Zero dependencies**: Pure Bun APIs only
2. **Convention over configuration**: `_functions/`, `_redirects`, `404.html`
3. **Dev/prod parity**: Same code, different caching strategies
4. **Simple caching**: No Redis, just in-memory with mtime checks
5. **Atomic writes**: sites.json uses temp file + rename

## Common Tasks

**Add a site:** Via bunpaas-admin UI or directly edit sites.json

**Deploy:** POST tarball to `/deploy` with `X-Deploy-Key` and `X-Target-Host` headers

**Debug:** `journalctl -u bunpaas -f` or check `/var/www/logs/{host}.json`

**Restart:** `sudo systemctl restart bunpaas`
