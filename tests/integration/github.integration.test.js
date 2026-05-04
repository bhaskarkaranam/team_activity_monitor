/**
 * Integration tests — hit real GitHub API.
 * Requires .env with: GITHUB_TOKEN, TEST_GITHUB_USERNAME
 * Run with: npm run test:integration
 */
require('dotenv').config();

const { GITHUB_TOKEN, TEST_GITHUB_USERNAME } = process.env;

const skip = !GITHUB_TOKEN || !TEST_GITHUB_USERNAME;

const GithubProvider = require('../../src/providers/GithubProvider');

(skip ? describe.skip : describe)('GitHub integration', () => {
  let provider;

  beforeAll(() => {
    provider = new GithubProvider({ token: GITHUB_TOKEN });
  });

  test('returns valid response shape for known user', async () => {
    const result = await provider.fetchActivity({ username: TEST_GITHUB_USERNAME });

    expect(result).toHaveProperty('commits');
    expect(result).toHaveProperty('openPRs');
    expect(result).toHaveProperty('activeRepos');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.commits)).toBe(true);
    expect(Array.isArray(result.openPRs)).toBe(true);
    expect(Array.isArray(result.activeRepos)).toBe(true);
  });

  test('each commit has required fields', async () => {
    const result = await provider.fetchActivity({ username: TEST_GITHUB_USERNAME });

    for (const commit of result.commits) {
      expect(commit).toHaveProperty('sha');
      expect(commit.sha).toHaveLength(7);
      expect(commit).toHaveProperty('message');
      expect(commit).toHaveProperty('repo');
      expect(commit).toHaveProperty('date');
    }
  });

  test('each open PR has required fields', async () => {
    const result = await provider.fetchActivity({ username: TEST_GITHUB_USERNAME });

    for (const pr of result.openPRs) {
      expect(pr).toHaveProperty('number');
      expect(pr).toHaveProperty('title');
      expect(pr).toHaveProperty('repo');
      expect(pr).toHaveProperty('url');
    }
  });

  test('returns warnings (not throws) for non-existent username', async () => {
    const result = await provider.fetchActivity({ username: 'this-user-xyz-does-not-exist-99999' });

    // All sub-calls fail gracefully with warnings
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('returns warnings (not throws) for bad token', async () => {
    const badProvider = new GithubProvider({ token: 'bad-token' });
    const result = await badProvider.fetchActivity({ username: TEST_GITHUB_USERNAME });

    expect(result.warnings.length).toBeGreaterThan(0);
  });
}, 20000);
