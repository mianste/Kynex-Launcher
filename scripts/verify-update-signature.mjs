import { readFileSync } from "node:fs";
import { createPublicKey, createHash, verify } from "node:crypto";
import assert from "node:assert/strict";
const [artifact, signaturePath, expectedVersion] = process.argv.slice(2);
const publicLines = Buffer.from(
  readFileSync("config/updater-public-key.txt", "utf8").trim(),
  "base64",
)
  .toString("utf8")
  .trim()
  .split(/\r?\n/);
const signatureLines = Buffer.from(
  readFileSync(signaturePath, "utf8").trim(),
  "base64",
)
  .toString("utf8")
  .trim()
  .split(/\r?\n/);
const key = Buffer.from(publicLines[1], "base64");
const sig = Buffer.from(signatureLines[1], "base64");
const trusted = signatureLines[2].replace(/^trusted comment: /, "");
assert.ok(
  trusted.split("\t").includes("version:" + expectedVersion),
  "Signed version must match manifest version",
);
assert.ok(
  key.subarray(2, 10).equals(sig.subarray(2, 10)),
  "Signature key does not match embedded public key",
);
const publicKey = createPublicKey({
  key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    key.subarray(10),
  ]),
  format: "der",
  type: "spki",
});
const bytes = readFileSync(artifact);
const message = (data) =>
  sig[1] === 0x44 ? createHash("blake2b512").update(data).digest() : data;
assert.ok(
  verify(null, message(bytes), publicKey, sig.subarray(10)),
  "Invalid update package signature",
);
assert.ok(
  verify(
    null,
    Buffer.concat([sig.subarray(10), Buffer.from(trusted)]),
    publicKey,
    Buffer.from(signatureLines[3], "base64"),
  ),
  "Invalid signed version metadata",
);
const changed = Buffer.from(bytes);
changed[Math.floor(changed.length / 2)] ^= 1;
assert.equal(
  verify(null, message(changed), publicKey, sig.subarray(10)),
  false,
  "Tampered package must be rejected",
);
console.log(
  JSON.stringify({
    version: expectedVersion,
    signature: "valid",
    signedVersion: "valid",
    tamperedPackage: "rejected",
  }),
);
