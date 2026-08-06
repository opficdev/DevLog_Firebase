process.env.GOOGLE_OAUTH_CONFIG = JSON.stringify({
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
});

process.env.APPLE_AUTH_CONFIG = JSON.stringify({
  teamId: 'test-team-id',
  clientId: 'test-client-id',
  keyId: 'test-key-id',
  privateKey: 'test-private-key',
});
