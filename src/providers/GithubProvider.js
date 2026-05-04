const axios = require('axios');
const ActivityProvider = require('./ActivityProvider');
const { ProviderAuthError, ProviderNotFoundError, ProviderRateLimitError, ProviderNetworkError } = require('../errors/AppError');
const logger = require('../logger');

const ACTIVITY_EVENT_TYPES = new Set(['PushEvent', 'PullRequestEvent', 'CreateEvent', 'IssuesEvent']);

class GithubProvider extends ActivityProvider {
  constructor({ token }) {
    super();
    this._client = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 10000,
    });
  }

  get name() { return 'github'; }

  async fetchActivity({ username }) {
    const start = Date.now();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [commitsResult, prsResult, eventsResult] = await Promise.allSettled([
      this._fetchCommits(username, since),
      this._fetchOpenPRs(username),
      this._fetchActiveRepos(username),
    ]);

    const warnings = [];
    const extract = (result, label) => {
      if (result.status === 'fulfilled') return result.value;
      warnings.push(`${label} fetch failed: ${result.reason?.message}`);
      return null;
    };

    const result = {
      commits: extract(commitsResult, 'commits') ?? [],
      openPRs: extract(prsResult, 'prs') ?? [],
      activeRepos: extract(eventsResult, 'events') ?? [],
      warnings,
    };

    logger.info({ provider: 'github', durationMs: Date.now() - start, warnings }, 'GitHub fetch complete');
    return result;
  }

  async _fetchCommits(username, since) {
    const { data } = await this._client
      .get('/search/commits', {
        params: { q: `author:${username} author-date:>=${since}`, sort: 'author-date', order: 'desc', per_page: 10 },
        headers: { Accept: 'application/vnd.github.cloak-preview+json' },
      })
      .catch((err) => { throw this._mapError(err, username); });

    return data.items.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0],
      repo: c.repository.full_name,
      date: c.commit.author.date,
    }));
  }

  async _fetchOpenPRs(username) {
    const { data } = await this._client
      .get('/search/issues', {
        params: { q: `is:pr author:${username} is:open`, per_page: 10, sort: 'updated' },
      })
      .catch((err) => { throw this._mapError(err, username); });

    return data.items.map((pr) => ({
      number: pr.number,
      title: pr.title,
      repo: pr.repository_url.replace('https://api.github.com/repos/', ''),
      url: pr.html_url,
      updatedAt: pr.updated_at,
    }));
  }

  async _fetchActiveRepos(username) {
    const { data } = await this._client
      .get(`/users/${username}/events/public`, { params: { per_page: 30 } })
      .catch((err) => { throw this._mapError(err, username); });

    return [...new Set(data.filter((e) => ACTIVITY_EVENT_TYPES.has(e.type)).map((e) => e.repo.name))];
  }

  _mapError(err, username) {
    const status = err.response?.status;
    if (status === 401) return new ProviderAuthError('github', { username });
    if (status === 403 && err.response.headers['x-ratelimit-remaining'] === '0') {
      return new ProviderRateLimitError('github', err.response.headers['x-ratelimit-reset'], { username });
    }
    if (status === 404) return new ProviderNotFoundError('github', username, { username });
    if (err.code === 'ECONNABORTED') return new ProviderNetworkError('github', { username });
    return err;
  }
}

module.exports = GithubProvider;
