const QueryParserService = require('../../src/services/QueryParserService');
const { QueryParseError } = require('../../src/errors/AppError');

const makeOpenAI = (args) => ({
  chat: {
    completions: {
      create: jest.fn().mockResolvedValue({
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }],
      }),
    },
  },
});

describe('QueryParserService.parse', () => {
  test('extracts member name and general_activity intent', async () => {
    const service = new QueryParserService(
      makeOpenAI({ memberName: 'alice', intent: 'general_activity', timeframe: 'recent' })
    );
    const result = await service.parse('What is Alice working on?', ['alice', 'bob']);
    expect(result).toMatchObject({ memberName: 'alice', intent: 'general_activity', timeframe: 'recent' });
  });

  test('detects jira_only intent', async () => {
    const service = new QueryParserService(
      makeOpenAI({ memberName: 'bob', intent: 'jira_only', timeframe: 'recent' })
    );
    const result = await service.parse("Show me Bob's JIRA tickets", ['bob']);
    expect(result.intent).toBe('jira_only');
  });

  test('detects github_only intent with this_week timeframe', async () => {
    const service = new QueryParserService(
      makeOpenAI({ memberName: 'alice', intent: 'github_only', timeframe: 'this_week' })
    );
    const result = await service.parse('What has Alice committed this week?', ['alice']);
    expect(result.intent).toBe('github_only');
    expect(result.timeframe).toBe('this_week');
  });

  test('throws QueryParseError when OpenAI returns no tool call', async () => {
    const service = new QueryParserService({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'Hello' } }] }),
        },
      },
    });
    await expect(service.parse('hello', [])).rejects.toBeInstanceOf(QueryParseError);
  });

  test('throws QueryParseError when tool call arguments are malformed JSON', async () => {
    const service = new QueryParserService({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { tool_calls: [{ function: { arguments: 'not-valid-json' } }] } }],
          }),
        },
      },
    });
    await expect(service.parse('test', [])).rejects.toBeInstanceOf(QueryParseError);
  });

  test('passes member aliases to OpenAI system prompt', async () => {
    const openai = makeOpenAI({ memberName: 'alice', intent: 'general_activity', timeframe: 'recent' });
    const service = new QueryParserService(openai);
    await service.parse('What is Alice doing?', ['alice', 'aj', 'bob']);

    const callArgs = openai.chat.completions.create.mock.calls[0][0];
    const systemMessage = callArgs.messages.find((m) => m.role === 'system');
    expect(systemMessage.content).toContain('alice');
    expect(systemMessage.content).toContain('bob');
  });
});
