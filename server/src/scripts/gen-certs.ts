import forge from "node-forge";
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

console.log("Generating 2048-bit RSA keypair (a few seconds)...");
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();

cert.publicKey = keys.publicKey;
cert.serialNumber = "01" + Date.now().toString(16);
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2);

const attrs = [
  { name: "commonName", value: "workspaceos.local" },
  { name: "organizationName", value: "WorkspaceOS" },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([
  { name: "basicConstraints", cA: false },
  { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
  { name: "extKeyUsage", serverAuth: true },
  {
    name: "subjectAltName",
    altNames: [
      { type: 2, value: "localhost" },
      { type: 2, value: "workspaceos.local" },
      { type: 7, ip: "127.0.0.1" },
    ],
  },
]);

cert.sign(keys.privateKey, forge.md.sha256.create());

fs.writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));

console.log("\nGenerated self-signed cert:");
console.log("  " + certPath);
console.log("  " + keyPath);
console.log("\nValid for 2 years. Browsers will warn on first visit — accept once.");
