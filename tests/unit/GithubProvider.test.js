const nock = require('nock');
const GithubProvider = require('../../src/providers/GithubProvider');

const GH = 'https://api.github.com';
const USERNAME = 'testuser';
const provider = new GithubProvider({ token: 'test-token' });

const mockCommit = () => ({
  sha: 'abc1234567',
  commit: { message: 'feat: add feature\nDetails here', author: { date: '2026-05-01T10:00:00Z' } },
  repository: { full_name: 'org/repo' },
});

const mockPR = () => ({
  number: 42,
  title: 'Refactor DB pooling',
  repository_url: 'https://api.github.com/repos/org/core-api',
  html_url: 'https://github.com/org/core-api/pull/42',
  updated_at: '2026-05-01T10:00:00Z',
});

const mockEvent = (type = 'PushEvent', repo = 'org/repo') => ({ type, repo: { name: repo } });

afterEach(() => nock.cleanAll());

describe('GithubProvider.fetchActivity', () => {
  test('returns commits, open PRs and active repos on success', async () => {
    nock(GH).get('/search/commits').query(true).reply(200, { items: [mockCommit()] });
    nock(GH).get('/search/issues').query(true).reply(200, { items: [mockPR()] });
    nock(GH).get(`/users/${USERNAME}/events/public`).query(true).reply(200, [mockEvent()]);

    const result = await provider.fetchActivity({ username: USERNAME });

    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].sha).toBe('abc1234'); // sliced to 7
    expect(result.commits[0].message).toBe('feat: add feature'); // first line only
    expect(result.openPRs[0].repo).toBe('org/core-api');
    expect(result.activeRepos).toContain('org/repo');
    expect(result.warnings).toHaveLength(0);
  });

  test('deduplicates active repos from events', async () => {
    nock(GH).get('/search/commits').query(true).reply(200, { items: [] });
    nock(GH).get('/search/issues').query(true).reply(200, { items: [] });
    nock(GH).get(`/users/${USERNAME}/events/public`).query(true).reply(200, [
      mockEvent('PushEvent', 'org/repo'),
      mockEvent('PushEvent', 'org/repo'),
      mockEvent('CreateEvent', 'org/other'),
    ]);

    const result = await provider.fetchActivity({ username: USERNAME });

    expect(result.activeRepos).toEqual(['org/repo', 'org/other']);
  });

  test('returns partial result with warning when one sub-call fails', async () => {
    nock(GH).get('/search/commits').query(true).reply(500);
    nock(GH).get('/search/issues').query(true).reply(200, { items: [mockPR()] });
    nock(GH).get(`/users/${USERNAME}/events/public`).query(true).reply(200, []);

    const result = await provider.fetchActivity({ username: USERNAME });

    expect(result.commits).toEqual([]);
    expect(result.openPRs).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('commits');
  });

  test('accumulates warnings for all failing sub-calls', async () => {
    nock(GH).get('/search/commits').query(true).reply(500);
    nock(GH).get('/search/issues').query(true).reply(500);
    nock(GH).get(`/users/${USERNAME}/events/public`).query(true).reply(404);

    const result = await provider.fetchActivity({ username: USERNAME });

    expect(result.warnings).toHaveLength(3);
  });

  test('ignores non-activity event types', async () => {
    nock(GH).get('/search/commits').query(true).reply(200, { items: [] });
    nock(GH).get('/search/issues').query(true).reply(200, { items: [] });
    nock(GH).get(`/users/${USERNAME}/events/public`).query(true).reply(200, [
      mockEvent('WatchEvent', 'org/some-repo'), // should be ignored
      mockEvent('PushEvent', 'org/active-repo'),
    ]);

    const result = await provider.fetchActivity({ username: USERNAME });

    expect(result.activeRepos).toEqual(['org/active-repo']);
  });

  test('commit message is truncated to first line', async () => {
    nock(GH).get('/search/commits').query(true).reply(200, { items: [mockCommit()] });
    nock(GH).get('/search/issues').query(true).reply(200, { items: [] });
    nock(GH).get(`/users/${USERNAME}/events/public`).query(true).reply(200, []);

    const result = await provider.fetchActivity({ username: USERNAME });

    expect(result.commits[0].message).not.toContain('Details here');
  });
});
