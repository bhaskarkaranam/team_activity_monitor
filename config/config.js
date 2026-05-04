require('dotenv').config();
const path = require('path');

const required = (name) => {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
};

module.exports = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? null,
    baseUrl: process.env.OPENAI_BASE_URL ?? null,
    model: process.env.OPENAI_MODEL ?? 'llama-3.3-70b-versatile',
  },
  jira: {
    baseUrl: required('JIRA_BASE_URL'),
    authHeader: `Basic ${Buffer.from(
      `${required('JIRA_USER_EMAIL')}:${required('JIRA_API_TOKEN')}`
    ).toString('base64')}`,
  },
  github: { token: required('GITHUB_TOKEN') },
  githubOrg: process.env.GITHUB_ORG ?? null,
  port: parseInt(process.env.PORT || '3000', 10),
  teamJsonPath: path.join(__dirname, 'team.json'),
};
