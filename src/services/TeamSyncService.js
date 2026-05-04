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
    logger.info('Starting team sync...');

    const [jiraUsers, githubUsers] = await Promise.all([
      this._fetchJiraUsers(),
      githubOrg ? this._fetchGithubOrgMembers(githubOrg) : [],
    ]);

    logger.info({ jiraCount: jiraUsers.length, githubCount: githubUsers.length }, 'Fetched users from APIs');

    const members = this._merge(jiraUsers, githubUsers);
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

  _merge(jiraUsers, githubUsers) {
    // Build a lookup map: email → github user (for fast matching)
    const githubByEmail = new Map(
      githubUsers.filter((u) => u.email).map((u) => [u.email, u])
    );

    // Build a lookup map: normalized name → github user (fallback)
    const githubByName = new Map(
      githubUsers.map((u) => [this._normalize(u.displayName), u])
    );

    const matched = new Set();
    const members = [];

    for (const jira of jiraUsers) {
      const gh =
        (jira.email && githubByEmail.get(jira.email)) ||
        githubByName.get(this._normalize(jira.displayName)) ||
        null;

      if (gh) matched.add(gh.username);

      members.push({
        displayName: jira.displayName,
        aliases: this._buildAliases(jira.displayName),
        jira: { accountId: jira.accountId },
        github: gh ? { username: gh.username } : null,
      });
    }

    // Add GitHub-only members (not found in JIRA)
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

  _normalize(name) {
    return name.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  _write(members) {
    fs.writeFileSync(this._teamJsonPath, JSON.stringify({ members }, null, 2));
  }
}

module.exports = TeamSyncService;
