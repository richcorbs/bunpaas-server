# BunPaaS Server

A lightweight Bun-based PaaS for hosting static sites with serverless functions. Zero npm dependencies.

## Architecture

```
                         ┌─────────────┐
    HTTP :80  ──────────►│             │
   HTTPS :443 ──────────►│   Caddy     │──► Auto SSL via Let's Encrypt
                         │             │
                         └──────┬──────┘
                                │
                                ▼ :7001
                    ┌───────────────────────┐
                    │    Bun.serve()        │
                    │  ┌─────────────────┐  │
                    │  │ Router (by host)│  │
                    │  │   ├─ Static     │  │
                    │  │   └─ Functions  │  │
                    │  └─────────────────┘  │
                    └───────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │     /var/www/         │
                    │  sites.json           │
                    │  sites/               │
                    │    └── example.com/   │
                    │        └── current/   │
                    └───────────────────────┘
```

## Development (macOS)

1. **Install Bun:**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Add hosts entries:**
   ```bash
   sudo sh -c 'echo "127.0.0.1 bunpaas-admin.localhost" >> /etc/hosts'
   ```

3. **Create data directory:**
   ```bash
   sudo mkdir -p /var/www/sites
   sudo chown -R $(whoami) /var/www
   ```

4. **Start the server:**
   ```bash
   NODE_ENV=development bun run server.js
   ```

5. **Access:**
   - http://bunpaas-admin.localhost:7001

## Production (Ubuntu 22.04+)

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Verify
bun --version
```

### 2. Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### 3. Deploy the PaaS

```bash
# Clone to /opt
cd /opt
sudo git clone <repo-url> bunpaas
sudo chown -R $USER:$USER /opt/bunpaas

# Create data directory
sudo mkdir -p /var/www/sites
sudo chown -R $USER:$USER /var/www
```

### 4. Configure Caddy

```bash
sudo cp /opt/bunpaas/bunpaas-server/Caddyfile /etc/caddy/Caddyfile
```

Or create `/etc/caddy/Caddyfile`:

```
{
	on_demand_tls {
		ask http://127.0.0.1:7001/caddy-check
	}
}

:443 {
	tls {
		on_demand
	}
	reverse_proxy 127.0.0.1:7001
}

:80 {
	redir https://{host}{uri} permanent
}
```

### 5. Create systemd service for PaaS

```bash
sudo tee /etc/systemd/system/bunpaas.service > /dev/null << 'EOF'
[Unit]
Description=BunPaaS Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/bunpaas/bunpaas-server
ExecStart=/root/.bun/bin/bun run server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bunpaas
Environment=NODE_ENV=production
Environment=BUNPAAS_DATA_DIR=/var/www
Environment=BUNPAAS_PORT=7001

[Install]
WantedBy=multi-user.target
EOF
```

> **Note:** Adjust the `User` and bun path if not running as root. Find bun path with `which bun`.

### 6. Enable and start services

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable services (start on boot)
sudo systemctl enable bunpaas
sudo systemctl enable caddy

# Start services
sudo systemctl start bunpaas
sudo systemctl start caddy

# Check status
sudo systemctl status bunpaas
sudo systemctl status caddy
```

### 7. Configure firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 8. Verify

```bash
# Check PaaS is running
curl http://127.0.0.1:7001/health

# Check Caddy is proxying (will fail SSL until DNS is configured)
curl -k https://127.0.0.1/health
```

## Managing Services

```bash
# View logs
sudo journalctl -u bunpaas -f
sudo journalctl -u caddy -f

# Restart after code changes
sudo systemctl restart bunpaas

# Reload Caddy config (no downtime)
sudo systemctl reload caddy

# Stop services
sudo systemctl stop bunpaas
sudo systemctl stop caddy
```

## Adding Sites

1. **Create site via admin UI** or API:
   ```bash
   curl -X PUT https://bunpaas-admin.example.com/sites/mysite.com \
     -H "X-API-Key: YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"enabled": true}'
   ```

2. **Configure DNS:** Point `mysite.com` to your server IP

3. **Deploy:** SSL certificate auto-provisions on first request

## Serverless Functions

Create functions in `_functions/` directory:

```js
// _functions/hello.js
export function get(req) {
  return { body: { message: "Hello!" } };
}

export function post(req) {
  return { body: { received: req.body } };
}

// Default export handles all methods
export default function(req) {
  return { body: { method: req.method } };
}
```

**Dynamic routes:**
- `_functions/users/[id].js` → `/users/:id`
- Access via `req.params.id`

**Request object:**
```js
{
  method: "GET",
  path: "/hello",
  query: { foo: "bar" },
  headers: { ... },
  body: { ... },
  params: { id: "123" },
  env: { ... }
}
```

**Response object:**
```js
{
  status: 200,
  headers: { "X-Custom": "header" },
  body: { data: "..." }  // Object, string, or Buffer
}
```

## Site Configuration

Create `site.json` in your site root:

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

## Redirects

Create a `_redirects` file in your site root:

```
# Simple redirect
/old-page /new-page

# With status code (default is 301)
/temporary /somewhere 302

# Wildcard redirects
/blog/* /posts/:splat
```

**Rules:**
- One redirect per line
- Format: `/from /to [status]`
- Status defaults to 301 (permanent)
- Wildcards: `/*` captures the rest of the path, `:splat` inserts it
- Lines starting with `#` are comments

**Examples:**
```
# Redirect old blog URLs
/blog/* /articles/:splat

# Shortened URLs
/gh https://github.com/myuser 302

# Moved pages
/about-us /about
```

## Custom Error Pages

Place HTML files named by status code in your site root:

- `404.html` - Not found
- `500.html` - Server error

If no custom error page exists, plain text is returned.

## Tests

Run the test suite:

```bash
bun test
```

## Troubleshooting

**PaaS won't start:**
```bash
sudo journalctl -u bunpaas -n 50
```

**Caddy won't start:**
```bash
sudo journalctl -u caddy -n 50
caddy validate --config /etc/caddy/Caddyfile
```

**SSL not working:**
- Verify DNS points to server: `dig mysite.com`
- Check Caddy can reach PaaS: `curl http://127.0.0.1:7001/caddy-check?domain=mysite.com`
- Check Caddy logs: `sudo journalctl -u caddy -f`

**502 Bad Gateway:**
- PaaS not running: `sudo systemctl status bunpaas`
- Wrong port: verify `BUNPAAS_PORT=7001` matches Caddyfile

## Directory Structure

```
/var/www/
├── sites.json              # Global config & secrets
├── logs/                   # Request logs per site
└── sites/
    └── example.com/
        ├── current/        # Active deployment
        │   ├── index.html
        │   ├── site.json
        │   └── _functions/
        └── deploys/        # Deploy history
```
