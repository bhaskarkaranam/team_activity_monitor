const axios = require('axios');
const ActivityProvider = require('./ActivityProvider');
const { ProviderAuthError, ProviderNetworkError } = require('../errors/AppError');
const logger = require('../logger');

class JiraProvider extends ActivityProvider {
  constructor({ baseUrl, authHeader }) {
    super();
    this._client = axios.create({
      baseURL: baseUrl,
      headers: { Authorization: authHeader, Accept: 'application/json' },
      timeout: 10000,
    });
  }

  get name() { return 'jira'; }

  async fetchIssueDetail(issueKey) {
    const start = Date.now();
    logger.debug({ provider: 'jira', issueKey }, 'Fetching JIRA issue detail');

    const [issueRes, changelogRes, commentsRes] = await Promise.allSettled([
      this._client.get(`/rest/api/3/issue/${issueKey}`, {
        params: { fields: 'summary,status,assignee,priority,updated,description,comment' },
      }),
      this._client.get(`/rest/api/3/issue/${issueKey}/changelog`),
      this._client.get(`/rest/api/3/issue/${issueKey}/comment`, {
        params: { orderBy: '-created', maxResults: 3 },
      }),
    ]);

    if (issueRes.status === 'rejected') {
      const status = issueRes.reason?.response?.status;
      if (status === 401) throw new ProviderAuthError('jira', { issueKey });
      if (status === 404) throw new Error(`Issue ${issueKey} not found`);
      throw issueRes.reason;
    }

    const { fields } = issueRes.value.data;

    const recentChanges = changelogRes.status === 'fulfilled'
      ? changelogRes.value.data.values
          .slice(-10)
          .reverse()
          .flatMap((h) =>
            h.items.map((item) => ({
              field: item.field,
              from: item.fromString,
              to: item.toString,
              changedBy: h.author?.displayName ?? 'Unknown',
              changedAt: h.created,
            }))
          )
      : [];

    const recentComments = commentsRes.status === 'fulfilled'
      ? commentsRes.value.data.comments.map((c) => ({
          author: c.author?.displayName ?? 'Unknown',
          body: this._extractText(c.body),
          createdAt: c.created,
        }))
      : [];

    logger.info({ provider: 'jira', issueKey, durationMs: Date.now() - start }, 'Issue detail fetch success');

    return {
      key: issueKey,
      summary: fields.summary,
      status: fields.status.name,
      priority: fields.priority?.name ?? 'None',
      assignee: fields.assignee?.displayName ?? 'Unassigned',
      updatedAt: fields.updated,
      recentChanges,
      recentComments,
    };
  }

  // Recursively extract plain text from Atlassian Document Format (ADF)
  _extractText(node) {
    if (!node) return '';
    if (node.type === 'text') return node.text ?? '';
    if (Array.isArray(node.content)) return node.content.map((n) => this._extractText(n)).join(' ');
    return '';
  }

  async fetchActivity({ accountId }) {
    const start = Date.now();
    logger.debug({ provider: 'jira', accountId }, 'Fetching JIRA activity');

    try {
      const { data } = await this._client.get('/rest/api/3/search', {
        params: {
          jql: `assignee=${accountId} AND statusCategory != Done ORDER BY updated DESC`,
          maxResults: 10,
          fields: 'summary,status,priority,updated,issuetype,project',
        },
      });

      logger.info({ provider: 'jira', resultCount: data.total, durationMs: Date.now() - start }, 'JIRA fetch success');

      return {
        total: data.total,
        issues: data.issues.map((issue) => ({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status.name,
          priority: issue.fields.priority?.name ?? 'None',
          project: issue.fields.project.name,
          updatedAt: issue.fields.updated,
        })),
      };
    } catch (err) {
      if (err.response?.status === 401) throw new ProviderAuthError('jira', { accountId });
      if (err.code === 'ECONNABORTED') throw new ProviderNetworkError('jira', { accountId });
      throw err;
    }
  }
}

module.exports = JiraProvider;
