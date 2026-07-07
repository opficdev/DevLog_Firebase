const assert = require("assert");

const axiosCalls = [];
const axiosRequests = [];
let revokeErrorStatus = 422;
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
    },
    async request(config) {
        axiosRequests.push(config);

        if (config.method === "delete") {
            throw axiosError(revokeErrorStatus);
        }

        if (config.method === "post") {
            throw axiosError(404);
        }

        throw new Error(`Unexpected GitHub API method: ${config.method}`);
    },
    isAxiosError(error) {
        return error?.isAxiosError === true;
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

const {
    requestGithubTokensWithCode,
    revokeGithubAccessTokenWithDatabase
} = require("../lib/rest/githubAuth");

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
        assertHeaders("https://api.github.com/user");
        assertHeaders("https://api.github.com/user/emails");

        await assertRevokedTokenIsTreatedAsSuccess(422);
        await assertRevokedTokenIsTreatedAsSuccess(404);
    } finally {
        restoreEnv("GITHUB_CLIENT_ID", originalClientID);
        restoreEnv("GITHUB_CLIENT_SECRET", originalClientSecret);
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

function assertHeaders(url) {
    const call = axiosCalls.find((item) => item.url === url);

    assert.ok(call, `${url} request should be made.`);
    assert.strictEqual(call.headers.Authorization, "Bearer access-token");
    assert.strictEqual(call.headers.Accept, "application/vnd.github+json");
    assert.ok(call.headers["User-Agent"]);
}

function assertRevokeHeaders(call) {
    assert.strictEqual(call.headers.Accept, "application/vnd.github+json");
    assert.strictEqual(call.headers["User-Agent"], "DevLog-Firebase");
}

async function assertRevokedTokenIsTreatedAsSuccess(status) {
    revokeErrorStatus = status;
    axiosRequests.length = 0;

    const revokeResult = await revokeGithubAccessTokenWithDatabase(
        fakeFirestore("revoked-token"),
        "firebase-uid"
    );

    assert.deepStrictEqual(revokeResult, { success: true });
    assert.strictEqual(axiosRequests.length, 2);
    assert.strictEqual(axiosRequests[0].method, "delete");
    assert.strictEqual(axiosRequests[0].url, "https://api.github.com/applications/client-id/token");
    assert.deepStrictEqual(axiosRequests[0].auth, {
        username: "client-id",
        password: "client-secret"
    });
    assert.deepStrictEqual(axiosRequests[0].data, {
        access_token: "revoked-token"
    });
    assertRevokeHeaders(axiosRequests[0]);

    assert.strictEqual(axiosRequests[1].method, "post");
    assert.strictEqual(axiosRequests[1].url, "https://api.github.com/applications/client-id/token");
    assert.deepStrictEqual(axiosRequests[1].data, {
        access_token: "revoked-token"
    });
    assertRevokeHeaders(axiosRequests[1]);
}

function axiosError(status) {
    const error = new Error(`Request failed with status code ${status}`);
    error.isAxiosError = true;
    error.response = { status };
    return error;
}

function fakeFirestore(accessToken) {
    return {
        collection(collectionName) {
            assert.strictEqual(collectionName, "users");

            return {
                doc(uid) {
                    assert.strictEqual(uid, "firebase-uid");

                    return {
                        collection(subCollectionName) {
                            assert.strictEqual(subCollectionName, "userData");

                            return {
                                doc(documentID) {
                                    assert.strictEqual(documentID, "tokens");

                                    return {
                                        async get() {
                                            return {
                                                exists: true,
                                                data: () => ({
                                                    githubAccessToken: accessToken
                                                })
                                            };
                                        }
                                    };
                                }
                            };
                        }
                    };
                }
            };
        }
    };
}

function restoreEnv(key, value) {
    if (value === undefined) {
        delete process.env[key];
        return;
    }

    process.env[key] = value;
}
