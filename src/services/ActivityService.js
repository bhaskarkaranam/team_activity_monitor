const logger = require('../logger');

class ActivityService {
  constructor(providers) {
    this._providers = providers;
  }

  async fetchForMember(memberEntry, intent) {
    const eligible = this._providers.filter((p) => {
      if (memberEntry[p.name] == null) return false;
      if (intent === 'jira_only') return p.name === 'jira';
      if (intent === 'github_only') return p.name === 'github';
      return true;
    });

    const settled = await Promise.allSettled(
      eligible.map((p) => {
        logger.debug({ provider: p.name }, 'Provider fetch start');
        return p.fetchActivity(memberEntry[p.name]);
      })
    );

    const data = {};
    const warnings = [];

    eligible.forEach((p, i) => {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        data[p.name] = result.value;
      } else {
        data[p.name] = null;
        warnings.push(`${p.name}: ${result.reason?.message}`);
        logger.warn({ provider: p.name, error: result.reason?.message }, 'Provider fetch failed');
      }
    });

    return { data, warnings };
  }

  async fetchIssueDetail(issueKey) {
    const jiraProvider = this._providers.find((p) => p.name === 'jira');
    if (!jiraProvider) throw new Error('No JIRA provider configured');
    return jiraProvider.fetchIssueDetail(issueKey);
  }
}

module.exports = ActivityService;
