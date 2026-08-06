const assert = require("assert");
const fs = require("fs");
const path = require("path");

const configurationPath = path.resolve(__dirname, "../../firebase.json");
const configuration = JSON.parse(fs.readFileSync(configurationPath, "utf8"));
const staging = configuration.hosting.find(({ site }) => site === "devlog-staging");
const production = configuration.hosting.find(({ site }) => site === "devlog-auth-prod");

assert.ok(staging);
assert.deepStrictEqual(staging.rewrites, [
    {
        source: "/api/todos/**",
        run: {
            serviceId: "http-api",
            region: "asia-northeast3"
        }
    },
    {
        source: "/api/web-pages/**",
        run: {
            serviceId: "http-api",
            region: "asia-northeast3"
        }
    },
    {
        source: "/api/push-notifications/**",
        run: {
            serviceId: "http-api",
            region: "asia-northeast3"
        }
    },
    {
        source: "/api/auth/google/**",
        run: {
            serviceId: "http-api",
            region: "asia-northeast3"
        }
    },
    {
        source: "/api/auth/apple/**",
        run: {
            serviceId: "http-api",
            region: "asia-northeast3"
        }
    },
    {
        source: "/api/auth/github/sign-in-sessions",
        run: {
            serviceId: "http-api",
            region: "asia-northeast3"
        }
    },
    {
        source: "/api/auth/github/callback",
        run: {
            serviceId: "http-api",
            region: "asia-northeast3"
        }
    },
    {
        source: "/api/auth/github/custom-token",
        run: {
            serviceId: "http-api",
            region: "asia-northeast3"
        }
    },
    {
        source: "/api/auth/github/account-link-sessions",
        run: {
            serviceId: "http-api",
            region: "asia-northeast3"
        }
    },
    {
        source: "/api/**",
        function: {
            functionId: "api",
            region: "asia-northeast3"
        }
    }
]);
assert.strictEqual("pinTag" in staging.rewrites[0].run, false);
assert.strictEqual("pinTag" in staging.rewrites[1].run, false);
assert.strictEqual("pinTag" in staging.rewrites[2].run, false);
assert.strictEqual("pinTag" in staging.rewrites[3].run, false);
assert.strictEqual("pinTag" in staging.rewrites[4].run, false);
assert.strictEqual("pinTag" in staging.rewrites[5].run, false);
assert.strictEqual("pinTag" in staging.rewrites[6].run, false);
assert.strictEqual("pinTag" in staging.rewrites[7].run, false);
assert.strictEqual("pinTag" in staging.rewrites[8].run, false);

assert.ok(production);
assert.deepStrictEqual(production.rewrites, [
    {
        source: "/api/auth/github/callback",
        function: {
            functionId: "api",
            region: "asia-northeast3"
        }
    }
]);

console.log("Firebase Hosting configuration tests passed");
