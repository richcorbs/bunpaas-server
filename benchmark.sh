#!/bin/bash

# Simple benchmark script for paas server
# Uses Apache Bench (ab)

HOST="paas-admin.localhost:7001"
REQUESTS=1000
CONCURRENCY=10

echo "============================================"
echo "PaaS Server Benchmark"
echo "Host: $HOST"
echo "Requests: $REQUESTS, Concurrency: $CONCURRENCY"
echo "============================================"
echo ""

# Test 1: Static file (index.html)
echo ">>> Test 1: Static file (index.html)"
ab -n $REQUESTS -c $CONCURRENCY -H "Host: $HOST" "http://localhost:7001/" 2>&1 | grep -E "(Requests per second|Time per request|Failed requests)"
echo ""

# Test 2: Function endpoint (simple)
echo ">>> Test 2: Function endpoint (/auth)"
ab -n $REQUESTS -c $CONCURRENCY -H "Host: $HOST" "http://localhost:7001/auth" 2>&1 | grep -E "(Requests per second|Time per request|Failed requests)"
echo ""

# Test 3: Function with dynamic route
echo ">>> Test 3: Dynamic route function (/sites/paas-admin.richcorbs.com/deploys)"
ab -n $REQUESTS -c $CONCURRENCY -H "Host: $HOST" -H "X-API-Key: ak_1e603dd47e5e3f9127eefb8ddda795d7ed669455f17f68ca978e1877546ed042" "http://localhost:7001/sites/paas-admin.richcorbs.com/deploys" 2>&1 | grep -E "(Requests per second|Time per request|Failed requests)"
echo ""

# Test 4: Health check (minimal overhead baseline)
echo ">>> Test 4: Health check (baseline)"
ab -n $REQUESTS -c $CONCURRENCY "http://localhost:7001/health" 2>&1 | grep -E "(Requests per second|Time per request|Failed requests)"
echo ""

echo "============================================"
echo "Benchmark complete"
echo "============================================"
