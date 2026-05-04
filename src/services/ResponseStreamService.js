const logger = require('../logger');

const SYSTEM_PROMPT = `You are a helpful team activity assistant.
Summarize what a team member is working on using JIRA and GitHub data.
- Be concise (3-5 sentences)
- Cite JIRA ticket keys (e.g. PROJ-123: summary)
- Mention open PR titles if relevant
- If a data source is unavailable, briefly note it
- Do not invent information`;

class ResponseStreamService {
  constructor(openai) {
    this._openai = openai;
  }

  async stream(res, { memberEntry, activityData, warnings, originalQuery }) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const start = Date.now();

    try {
      const stream = await this._openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        max_tokens: 1024,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: this._buildPrompt(memberEntry, activityData, originalQuery) },
        ],
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) this._send(res, { type: 'delta', text: delta });
      }

      this._send(res, {
        type: 'done',
        sources: { jira: activityData.jira != null, github: activityData.github != null, warnings },
      });
      logger.info({ member: memberEntry.displayName, durationMs: Date.now() - start }, 'SSE stream complete');
    } catch (err) {
      logger.error({ err: err.message }, 'Stream error');
      this._send(res, { type: 'error', message: 'Failed to generate response. Please try again.' });
    } finally {
      res.end();
    }
  }

  _buildPrompt(member, data, query) {
    if (data.issueDetail) return this._buildIssueDetailPrompt(data.issueDetail, query);

    const jira = data.jira
      ? JSON.stringify(data.jira.issues, null, 2)
      : 'JIRA data unavailable';

    const github = data.github
      ? `Commits:\n${JSON.stringify(data.github.commits, null, 2)}\n\nOpen PRs:\n${JSON.stringify(data.github.openPRs, null, 2)}\n\nActive repos: ${data.github.activeRepos.join(', ')}`
      : 'GitHub data unavailable';

    const name = member?.displayName ?? 'the team member';
    return `User asked: "${query}"

=== ${name}'s JIRA (active tickets) ===
${jira}

=== ${name}'s GitHub (last 7 days) ===
${github}

Summarize what ${name} is working on.`;
  }

  _buildIssueDetailPrompt(issue, query) {
    return `User asked: "${query}"

=== Issue Detail ===
${JSON.stringify({ key: issue.key, summary: issue.summary, status: issue.status, priority: issue.priority, assignee: issue.assignee, updatedAt: issue.updatedAt }, null, 2)}

=== Recent Changes (latest first) ===
${issue.recentChanges.length ? JSON.stringify(issue.recentChanges, null, 2) : 'No recent changes recorded'}

=== Recent Comments (latest first) ===
${issue.recentComments.length ? JSON.stringify(issue.recentComments, null, 2) : 'No comments yet'}

Summarize the current status and recent updates on this issue.`;
  }

  _send(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

module.exports = ResponseStreamService;
