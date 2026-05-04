const nock = require('nock');
const JiraProvider = require('../../src/providers/JiraProvider');
const { ProviderAuthError, ProviderNetworkError } = require('../../src/errors/AppError');

const BASE_URL = 'https://test.atlassian.net';
const ACCOUNT_ID = 'abc123';

const provider = new JiraProvider({ baseUrl: BASE_URL, authHeader: 'Basic dGVzdA==' });

const mockIssue = (key = 'PROJ-1') => ({
  key,
  fields: {
    summary: 'Build login page',
    status: { name: 'In Progress' },
    priority: { name: 'High' },
    project: { name: 'Platform' },
    updated: '2026-05-01T10:00:00.000Z',
  },
});

afterEach(() => nock.cleanAll());

describe('JiraProvider.fetchActivity', () => {
  test('returns normalized issues on success', async () => {
    nock(BASE_URL).get('/rest/api/3/search/jql').query(true).reply(200, {
      total: 1,
      issues: [mockIssue()],
    });

    const result = await provider.fetchActivity({ accountId: ACCOUNT_ID });

    expect(result.total).toBe(1);
    expect(result.issues[0]).toMatchObject({
      key: 'PROJ-1',
      summary: 'Build login page',
      status: 'In Progress',
      priority: 'High',
      project: 'Platform',
    });
    expect(result.issues[0]).toHaveProperty('updatedAt');
  });

  test('returns empty issues array when nothing is assigned', async () => {
    nock(BASE_URL).get('/rest/api/3/search/jql').query(true).reply(200, { total: 0, issues: [] });

    const result = await provider.fetchActivity({ accountId: ACCOUNT_ID });

    expect(result).toEqual({ total: 0, issues: [] });
  });

  test('JQL contains accountId and statusCategory filter', async () => {
    let capturedParams;
    nock(BASE_URL)
      .get('/rest/api/3/search/jql')
      .query((q) => { capturedParams = q; return true; })
      .reply(200, { total: 0, issues: [] });

    await provider.fetchActivity({ accountId: ACCOUNT_ID });

    expect(capturedParams.jql).toContain(`assignee=${ACCOUNT_ID}`);
    expect(capturedParams.jql).toContain('statusCategory != Done');
  });

  test('throws ProviderAuthError on 401', async () => {
    nock(BASE_URL).get('/rest/api/3/search/jql').query(true).reply(401);

    await expect(provider.fetchActivity({ accountId: ACCOUNT_ID }))
      .rejects.toBeInstanceOf(ProviderAuthError);
  });

  test('ProviderAuthError carries correct code', async () => {
    nock(BASE_URL).get('/rest/api/3/search/jql').query(true).reply(401);

    await expect(provider.fetchActivity({ accountId: ACCOUNT_ID }))
      .rejects.toMatchObject({ code: 'JIRA_AUTH_FAILED' });
  });

  test('falls back to "None" when priority field is missing', async () => {
    const issue = mockIssue();
    delete issue.fields.priority;
    nock(BASE_URL).get('/rest/api/3/search/jql').query(true).reply(200, { total: 1, issues: [issue] });

    const result = await provider.fetchActivity({ accountId: ACCOUNT_ID });

    expect(result.issues[0].priority).toBe('None');
  });
});
