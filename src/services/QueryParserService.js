const { QueryParseError } = require('../errors/AppError');

const EXTRACT_TOOL = {
  type: 'function',
  function: {
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
  },
};

class QueryParserService {
  constructor(openai) {
    this._openai = openai;
  }

  async parse(userMessage, memberAliases) {
    const response = await this._openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      max_tokens: 256,
      temperature: 0,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'function', function: { name: 'extract_query_info' } },
      messages: [
        {
          role: 'system',
          content: `You are a query parser for a team activity monitor. Extract the member name and intent from the user's question. Known team aliases: ${memberAliases.join(', ')}. Always call extract_query_info.`,
        },
        { role: 'user', content: userMessage },
      ],
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new QueryParseError('OpenAI did not return a tool call', { userMessage });

    try {
      return JSON.parse(toolCall.function.arguments);
    } catch {
      throw new QueryParseError('Failed to parse tool call arguments', { args: toolCall.function.arguments });
    }
  }
}

module.exports = QueryParserService;
