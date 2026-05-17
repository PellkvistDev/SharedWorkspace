import bcrypt from "bcryptjs";
import readline from "node:readline";

async function prompt(q: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (hidden) {
    // Best-effort echo suppression
    const stdin = process.stdin as any;
    const onData = (char: Buffer) => {
      const c = char.toString("utf8");
      if (c === "\n" || c === "\r" || c === "") {
        stdin.removeListener("data", onData);
      } else {
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  }
  return new Promise((resolve) => rl.question(q, (a) => { rl.close(); console.log(""); resolve(a); }));
}

async function main() {
  const pw = process.argv[2] || (await prompt("Enter new password: ", true));
  if (!pw || pw.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  const hash = await bcrypt.hash(pw, 12);
  console.log("\nPaste this into your .env as PASSWORD_HASH:\n");
  console.log(hash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
