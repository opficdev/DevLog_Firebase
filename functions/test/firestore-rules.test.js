const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rulesPath = path.resolve(__dirname, "../../firestore.rules");
const rules = fs.readFileSync(rulesPath, "utf8");

assert.ok(rules.includes("function userDataWriteAllowed(userId)"));
assert.ok(rules.includes("documents/authCredentials/$(userId)"));
assert.ok(rules.includes("data.deletionStartedAt == null"));
assert.ok(rules.includes("userDataWriteAllowed(userId)"));
