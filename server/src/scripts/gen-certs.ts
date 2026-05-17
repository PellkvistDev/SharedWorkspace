import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const certsDir = path.resolve("./certs");
fs.mkdirSync(certsDir, { recursive: true });

const keyPath = path.join(certsDir, "key.pem");
const certPath = path.join(certsDir, "cert.pem");

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log("certs already exist:", keyPath, certPath);
  process.exit(0);
}

const subj = "/CN=workspaceos.local";
try {
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 825 -subj "${subj}" -addext "subjectAltName=DNS:localhost,DNS:workspaceos.local,IP:127.0.0.1"`,
    { stdio: "inherit" }
  );
  console.log("\nGenerated self-signed cert at", certPath);
} catch (err) {
  console.error("openssl is required. Install it (Git Bash on Windows ships with it) and try again.");
  process.exit(1);
}
