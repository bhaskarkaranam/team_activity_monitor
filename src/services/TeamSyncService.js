const fs = require('fs');
const axios = require('axios');
const logger = require('../logger');

class TeamSyncService {
  constructor({ jiraConfig, githubConfig, teamJsonPath }) {
    this._teamJsonPath = teamJsonPath;

    this._jira = axios.create({
      baseURL: jiraConfig.baseUrl,
      headers: { Authorization: jiraConfig.authHeader, Accept: 'application/json' },
      timeout: 10000,
    });

    this._github = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Authorization: `Bearer ${githubConfig.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 10000,
    });
  }

  async sync(githubOrg) {
    logger.info({ githubOrg: githubOrg ?? null }, 'Starting team sync');

    const [jiraUsers, githubUsers] = await Promise.all([
      this._fetchJiraUsers(),
      githubOrg ? this._fetchGithubOrgMembers(githubOrg) : [],
    ]);

    logger.info({ jiraCount: jiraUsers.length, githubCount: githubUsers.length }, 'Fetched users from APIs');

    const existingLinkages = this._loadExistingLinkages();
    const members = this._merge(jiraUsers, githubUsers, existingLinkages);
    this._write(members);

    logger.info({ memberCount: members.length }, 'team.json updated');
    return members;
  }

  async _fetchJiraUsers() {
    const users = [];
    let startAt = 0;
    const maxResults = 50;

    // Paginate through all active JIRA users
    while (true) {
      const { data } = await this._jira.get('/rest/api/3/users/search', {
        params: { query: '', maxResults, startAt },
      });

      const active = data.filter((u) => u.accountType === 'atlassian' && u.active);
      users.push(...active);

      if (data.length < maxResults) break;
      startAt += maxResults;
    }

    return users.map((u) => ({
      displayName: u.displayName,
      email: u.emailAddress?.toLowerCase() ?? null,
      accountId: u.accountId,
    }));
  }

  async _fetchGithubOrgMembers(org) {
    const { data: members } = await this._github.get(`/orgs/${org}/members`, {
      params: { per_page: 100 },
    });

    // Fetch each member's profile for email + full name (may be null if private)
    const profiles = await Promise.allSettled(
      members.map((m) => this._github.get(`/users/${m.login}`))
    );

    return profiles
      .map((result, i) => {
        if (result.status === 'rejected') return null;
        const { data: u } = result.value;
        return {
          username: u.login,
          displayName: u.name ?? u.login,
          email: u.email?.toLowerCase() ?? null,
        };
      })
      .filter(Boolean);
  }

  _loadExistingLinkages() {
    // Returns map of jira.accountId → github.username from current team.json
    // Preserves manual linkages across re-syncs when email matching fails
    try {
      const { members } = JSON.parse(fs.readFileSync(this._teamJsonPath, 'utf8'));
      const map = new Map();
      for (const m of members) {
        if (m.jira?.accountId && m.github?.username) {
          map.set(m.jira.accountId, m.github.username);
        }
      }
      return map;
    } catch {
      return new Map();
    }
  }

  _merge(jiraUsers, githubUsers, existingLinkages) {
    // Primary match: email (most reliable, fails when GitHub email is private)
    const githubByEmail = new Map(
      githubUsers.filter((u) => u.email).map((u) => [u.email, u])
    );

    const matched = new Set();
    const members = [];

    for (const jira of jiraUsers) {
      const ghByEmail = jira.email ? githubByEmail.get(jira.email) : null;
      const existingUsername = existingLinkages.get(jira.accountId);

      const githubUsername = ghByEmail?.username ?? existingUsername ?? null;
      if (ghByEmail) matched.add(ghByEmail.username);
      if (!ghByEmail && existingUsername) matched.add(existingUsername);

      members.push({
        displayName: jira.displayName,
        aliases: this._buildAliases(jira.displayName),
        jira: { accountId: jira.accountId },
        github: githubUsername ? { username: githubUsername } : null,
      });
    }

    // Add GitHub-only members (not linked to any JIRA user)
    for (const gh of githubUsers) {
      if (!matched.has(gh.username)) {
        members.push({
          displayName: gh.displayName,
          aliases: this._buildAliases(gh.displayName),
          jira: null,
          github: { username: gh.username },
        });
      }
    }

    return members;
  }

  _buildAliases(displayName) {
    const lower = displayName.toLowerCase();
    const parts = lower.split(/\s+/);
    const aliases = [lower];
    if (parts.length > 1) aliases.push(parts[0]); // first name only
    return [...new Set(aliases)];
  }


  _write(members) {
    fs.writeFileSync(this._teamJsonPath, JSON.stringify({ members }, null, 2));
  }
}

module.exports = TeamSyncService;
