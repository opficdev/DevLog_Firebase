const assert = require("assert");

const axiosCalls = [];
const fakeAxios = {
    async post(url, data, config) {
        assert.strictEqual(url, "https://github.com/login/oauth/access_token");
        assert.deepStrictEqual(data, {
            client_id: "client-id",
            client_secret: "client-secret",
            code: "github-code"
        });
        assert.deepStrictEqual(config, {
            headers: { "Accept": "application/json" }
        });

        return {
            data: {
                access_token: "access-token",
                token_type: "bearer",
                scope: "user:email"
            }
        };
    },
    async get(url, config) {
        axiosCalls.push({ url, headers: config?.headers });

        if (url === "https://api.github.com/user") {
            return {
                data: {
                    id: 1,
                    login: "github-user",
                    name: "GitHub User",
                    avatar_url: "https://example.com/avatar.png"
                }
            };
        }

        if (url === "https://api.github.com/user/emails") {
            return {
                data: [{
                    email: "user@example.com",
                    primary: true,
                    verified: true
                }]
            };
        }

        throw new Error(`Unexpected GitHub API URL: ${url}`);
    }
};

const fakeAuth = {
    async getUserByEmail(email) {
        assert.strictEqual(email, "user@example.com");

        return { uid: "firebase-uid" };
    },
    async createUser() {
        throw new Error("Existing GitHub email should be reused.");
    },
    async createCustomToken(uid) {
        assert.strictEqual(uid, "firebase-uid");

        return "custom-token";
    }
};

require.cache[require.resolve("axios")] = {
    exports: fakeAxios
};
require.cache[require.resolve("firebase-admin")] = {
    exports: {
        auth: () => fakeAuth
    }
};

const { requestGithubTokensWithCode } = require("../lib/rest/githubAuth");

(async () => {
    const originalClientID = process.env.GITHUB_CLIENT_ID;
    const originalClientSecret = process.env.GITHUB_CLIENT_SECRET;

    process.env.GITHUB_CLIENT_ID = "client-id";
    process.env.GITHUB_CLIENT_SECRET = "client-secret";

    try {
        const result = await requestGithubTokensWithCode("github-code");

        assert.deepStrictEqual(result, {
            accessToken: "access-token",
            customToken: "custom-token"
        });
        assertGitHubHeaders("https://api.github.com/user");
        assertGitHubHeaders("https://api.github.com/user/emails");
    } finally {
        restoreEnv("GITHUB_CLIENT_ID", originalClientID);
        restoreEnv("GITHUB_CLIENT_SECRET", originalClientSecret);
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

function assertGitHubHeaders(url) {
    const call = axiosCalls.find((item) => item.url === url);

    assert.ok(call, `${url} request should be made.`);
    assert.strictEqual(call.headers.Authorization, "Bearer access-token");
    assert.strictEqual(call.headers.Accept, "application/vnd.github+json");
    assert.ok(call.headers["User-Agent"]);
}

function restoreEnv(key, value) {
    if (value === undefined) {
        delete process.env[key];
        return;
    }

    process.env[key] = value;
}
