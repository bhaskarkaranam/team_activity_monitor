/**
 * Integration tests — hit real JIRA API.
 * Requires .env with: JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN, TEST_JIRA_ACCOUNT_ID
 * Run with: npm run test:integration
 */
require('dotenv').config();

const { JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN, TEST_JIRA_ACCOUNT_ID } = process.env;

const skip = !JIRA_BASE_URL || !JIRA_USER_EMAIL || !JIRA_API_TOKEN || !TEST_JIRA_ACCOUNT_ID;

const JiraProvider = require('../../src/providers/JiraProvider');
const { ProviderAuthError } = require('../../src/errors/AppError');

const makeProvider = (token = JIRA_API_TOKEN) => {
  const authHeader = `Basic ${Buffer.from(`${JIRA_USER_EMAIL}:${token}`).toString('base64')}`;
  return new JiraProvider({ baseUrl: JIRA_BASE_URL, authHeader });
};

(skip ? describe.skip : describe)('JIRA integration', () => {
  test('authenticates and returns a valid response shape', async () => {
    const result = await makeProvider().fetchActivity({ accountId: TEST_JIRA_ACCOUNT_ID });

    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('issues');
    expect(Array.isArray(result.issues)).toBe(true);
  });

  test('each issue has required fields', async () => {
    const result = await makeProvider().fetchActivity({ accountId: TEST_JIRA_ACCOUNT_ID });

    for (const issue of result.issues) {
      expect(issue).toHaveProperty('key');
      expect(issue).toHaveProperty('summary');
      expect(issue).toHaveProperty('status');
      expect(issue).toHaveProperty('priority');
      expect(issue).toHaveProperty('project');
      expect(issue).toHaveProperty('updatedAt');
    }
  });

  test('throws ProviderAuthError on bad credentials', async () => {
    await expect(makeProvider('bad-token').fetchActivity({ accountId: TEST_JIRA_ACCOUNT_ID }))
      .rejects.toBeInstanceOf(ProviderAuthError);
  });
}, 20000);
