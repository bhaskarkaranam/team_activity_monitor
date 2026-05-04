// Provide fake env vars so config.js doesn't throw during unit tests
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.JIRA_BASE_URL = 'https://test.atlassian.net';
process.env.JIRA_USER_EMAIL = 'test@test.com';
process.env.JIRA_API_TOKEN = 'test-jira-token';
process.env.GITHUB_TOKEN = 'test-github-token';
process.env.PORT = '3001';
process.env.LOG_LEVEL = 'silent'; // suppress logs during tests
