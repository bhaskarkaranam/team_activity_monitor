const QueryParserService = require('../../src/services/QueryParserService');
const { QueryParseError } = require('../../src/errors/AppError');

const makeAdapter = (result) => ({
  toolCall: jest.fn().mockResolvedValue(result),
});

describe('QueryParserService.parse', () => {
  test('extracts member name and general_activity intent', async () => {
    const service = new QueryParserService(
      makeAdapter({ memberName: 'alice', intent: 'general_activity', timeframe: 'recent' })
    );
    const result = await service.parse('What is Alice working on?', ['alice', 'bob']);
    expect(result).toMatchObject({ memberName: 'alice', intent: 'general_activity', timeframe: 'recent' });
  });

  test('detects jira_only intent', async () => {
    const service = new QueryParserService(
      makeAdapter({ memberName: 'bob', intent: 'jira_only', timeframe: 'recent' })
    );
    const result = await service.parse("Show me Bob's JIRA tickets", ['bob']);
    expect(result.intent).toBe('jira_only');
  });

  test('detects github_only intent with this_week timeframe', async () => {
    const service = new QueryParserService(
      makeAdapter({ memberName: 'alice', intent: 'github_only', timeframe: 'this_week' })
    );
    const result = await service.parse('What has Alice committed this week?', ['alice']);
    expect(result.intent).toBe('github_only');
    expect(result.timeframe).toBe('this_week');
  });

  test('throws QueryParseError when adapter returns null', async () => {
    const service = new QueryParserService(makeAdapter(null));
    await expect(service.parse('hello', [])).rejects.toBeInstanceOf(QueryParseError);
  });

  test('passes member aliases to the adapter system prompt', async () => {
    const adapter = makeAdapter({ memberName: 'alice', intent: 'general_activity', timeframe: 'recent' });
    const service = new QueryParserService(adapter);
    await service.parse('What is Alice doing?', ['alice', 'aj', 'bob']);

    const [system] = adapter.toolCall.mock.calls[0];
    expect(system).toContain('alice');
    expect(system).toContain('bob');
  });
});
