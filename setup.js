#!/usr/bin/env node
/**
 * BunPaaS Setup Script
 *
 * Run this once to initialize:
 *   sudo node setup.js
 *
 * This script:
 * 1. Creates /var/www directory structure
 * 2. Prompts for admin site hostname and credentials
 * 3. Creates initial sites.json
 */

import { promises as fs } from "fs";
import path from "path";
import { createInterface } from "readline";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";

const DATA_DIR = "/var/www";

function prompt(question, hidden = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      let input = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", function handler(char) {
        char = char.toString();
        if (char === "\n" || char === "\r") {
          process.stdin.setRawMode(false);
          process.stdin.removeListener("data", handler);
          process.stdout.write("\n");
          rl.close();
          resolve(input);
        } else if (char === "\u0003") {
          process.exit();
        } else if (char === "\u007F") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          input += char;
          process.stdout.write("*");
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function generateKey(prefix, length = 32) {
  return prefix + "_" + randomBytes(length).toString("hex");
}

async function setup() {
  console.log("\n========================================");
  console.log("  BunPaaS Setup");
  console.log("========================================\n");

  // Check if running as root (needed for /var/www)
  if (process.getuid && process.getuid() !== 0) {
    console.log("Warning: You may need to run this with sudo to write to /var/www\n");
  }

  // Check if already set up
  const sitesJsonPath = path.join(DATA_DIR, "sites.json");
  try {
    await fs.access(sitesJsonPath);
    const overwrite = await prompt("sites.json already exists. Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("Setup cancelled.");
      process.exit(0);
    }
  } catch {
    // File doesn't exist, continue
  }

  // Get admin site hostname
  console.log("Configure admin site:\n");
  let adminHost = await prompt("Admin site hostname (e.g., paas-admin.example.com): ");
  while (!adminHost || !adminHost.includes(".")) {
    console.log("Please enter a valid hostname.");
    adminHost = await prompt("Admin site hostname: ");
  }

  // Get admin credentials
  console.log("\nConfigure admin credentials:\n");
  const adminUsername = await prompt("Admin username (default: admin): ") || "admin";
  let adminPassword = await prompt("Admin password: ", true);
  while (!adminPassword || adminPassword.length < 8) {
    console.log("Password must be at least 8 characters.");
    adminPassword = await prompt("Admin password: ", true);
  }

  // Hash password
  console.log("\nGenerating credentials...");
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const apiKey = generateKey("ak");
  const adminDeployKey = generateKey("dk");

  // Create directory structure
  console.log("Creating directory structure...");
  await fs.mkdir(path.join(DATA_DIR, "sites"), { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, "certs"), { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, "tmp"), { recursive: true });

  // Create sites.json
  const sitesJson = {
    sites: {
      [adminHost]: {
        enabled: true,
        deployKey: adminDeployKey,
        env: {
          ADMIN_USERNAME: adminUsername,
          ADMIN_PASSWORD_HASH: passwordHash,
          API_KEY: apiKey,
        },
        created: new Date().toISOString(),
        lastDeploy: null,
      },
    },
  };

  await fs.writeFile(sitesJsonPath, JSON.stringify(sitesJson, null, 2) + "\n");
  console.log("Created sites.json");

  // Create site directory
  await fs.mkdir(path.join(DATA_DIR, "sites", adminHost, "current"), { recursive: true });
  console.log("Created site directory");

  // Summary
  console.log("\n========================================");
  console.log("  Setup Complete!");
  console.log("========================================\n");
  console.log("Admin site registered:");
  console.log(`  - ${adminHost}`);
  console.log("\nAdmin credentials:");
  console.log(`  Username: ${adminUsername}`);
  console.log("  Password: (as entered)");
  console.log(`  API Key:  ${apiKey}`);
  console.log("\nDeploy key (save this!):");
  console.log(`  ${adminHost}: ${adminDeployKey}`);
  console.log("\nNext steps:");
  console.log("  1. Deploy admin site");
  console.log("  2. Start the server: npm run dev");
  console.log(`  3. Visit https://${adminHost} to manage sites\n`);
}

setup().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
