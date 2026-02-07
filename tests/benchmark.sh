#!/bin/bash

# Benchmark configuration
PORT=7098
REQUESTS=10000
CONCURRENCY=100
TEST_DATA_DIR="/tmp/paas-bench-$$"
TEST_HOST="bench-site.richcorbs.com"

# Colors
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

setup() {
  SITE_DIR="$TEST_DATA_DIR/sites/$TEST_HOST/current"
  mkdir -p "$SITE_DIR/_functions"
  mkdir -p "$TEST_DATA_DIR/logs"

  # sites.json
  cat > "$TEST_DATA_DIR/sites.json" << EOF
{
  "sites": {
    "$TEST_HOST": {
      "enabled": true,
      "deployKey": "dk_bench",
      "env": {}
    }
  }
}
EOF

  # Static file
  echo "<h1>Hello</h1>" > "$SITE_DIR/index.html"

  # Function
  cat > "$SITE_DIR/_functions/api.js" << 'EOF'
export function get(req) {
  return { body: { ok: true, time: Date.now() } };
}
EOF
}

cleanup() {
  rm -rf "$TEST_DATA_DIR"
  pkill -f "server.js" 2>/dev/null || true
}
trap cleanup EXIT

benchmark() {
  local name=$1
  local path=$2
  echo -e "\n${YELLOW}$name${NC}"
  /usr/sbin/ab -n $REQUESTS -c $CONCURRENCY -H "Host: bench-site.localhost" \
    "http://localhost:$PORT$path" 2>&1 | grep -E "Requests per second|Time per request|Failed requests"
}

run_benchmarks() {
  local runtime=$1
  echo -e "\n${GREEN}=== $runtime ===${NC}"

  sleep 1  # Let server warm up

  benchmark "Health Check" "/health"
  benchmark "Static File" "/"
  benchmark "Function" "/api"
}

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  PaaS Benchmark: Node.js vs Bun${NC}"
echo -e "${YELLOW}========================================${NC}"

setup

# Node.js benchmark
echo -e "\n${YELLOW}Starting Node.js server...${NC}"
cd /Users/rich/Code/richhost/paas
NODE_ENV=development RICHHOST_DATA_DIR="$TEST_DATA_DIR" RICHHOST_PORT=$PORT node server.js &
NODE_PID=$!
sleep 2

run_benchmarks "Node.js"

kill $NODE_PID 2>/dev/null
wait $NODE_PID 2>/dev/null || true
sleep 1

# Bun benchmark
echo -e "\n${YELLOW}Starting Bun server...${NC}"
cd /Users/rich/Code/richhost/paas-bun
NODE_ENV=development RICHHOST_DATA_DIR="$TEST_DATA_DIR" RICHHOST_PORT=$PORT /Users/rich/.bun/bin/bun run server.js &
BUN_PID=$!
sleep 2

run_benchmarks "Bun"

kill $BUN_PID 2>/dev/null
wait $BUN_PID 2>/dev/null || true

echo -e "\n${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Benchmark Complete${NC}"
echo -e "${YELLOW}========================================${NC}"
