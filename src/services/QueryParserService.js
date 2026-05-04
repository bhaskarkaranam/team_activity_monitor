const { QueryParseError } = require('../errors/AppError');

const EXTRACT_TOOL = {
  name: 'extract_query_info',
  description: 'Extract team member name and query intent from the user message',
  parameters: {
    type: 'object',
    properties: {
      memberName: { type: 'string', description: 'The name or alias of the team member, lowercased. Optional when asking about a specific issue key.' },
      issueKey: { type: 'string', description: 'JIRA issue key when the user asks about a specific issue, e.g. PROJ-123. Only set when intent is issue_detail.' },
      intent: {
        type: 'string',
        enum: ['general_activity', 'jira_only', 'github_only', 'issue_detail'],
        description: 'Use issue_detail when the user asks about a specific JIRA issue key.',
      },
      timeframe: {
        type: 'string',
        enum: ['today', 'this_week', 'recent', 'this_month'],
      },
    },
    required: ['intent', 'timeframe'],
  },
};

class QueryParserService {
  constructor(aiAdapter) {
    this._ai = aiAdapter;
  }

  async parse(userMessage, memberAliases) {
    const system = `You are a query parser for a team activity monitor. Extract the member name and intent from the user's question. Known team aliases: ${memberAliases.join(', ')}. Always call extract_query_info.`;

    const result = await this._ai.toolCall(system, userMessage, EXTRACT_TOOL);
    if (!result) throw new QueryParseError('AI did not return a tool call', { userMessage });
    return result;
  }
}

module.exports = QueryParserService;
