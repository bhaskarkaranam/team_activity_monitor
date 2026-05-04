/**
 * Integration tests — hit real OpenAI API.
 * Requires .env with: OPENAI_API_KEY (must be a real key, not the test placeholder)
 * Run with: npm run test:integration
 */
require('dotenv').config();

const { OPENAI_API_KEY } = process.env;

const skip = !OPENAI_API_KEY || OPENAI_API_KEY === 'test-openai-key';

const { OpenAI } = require('openai');
const QueryParserService = require('../../src/services/QueryParserService');
const ResponseStreamService = require('../../src/services/ResponseStreamService');

(skip ? describe.skip : describe)('OpenAI integration', () => {
  let openai;

  beforeAll(() => {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  });

  describe('QueryParserService', () => {
    test('parses general activity query and returns required fields', async () => {
      const parser = new QueryParserService(openai);
      const result = await parser.parse("What is Alice working on these days?", ['alice', 'bob']);

      expect(result).toHaveProperty('memberName');
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('timeframe');
      expect(result.memberName.toLowerCase()).toContain('alice');
    }, 15000);

    test('classifies jira_only intent correctly', async () => {
      const parser = new QueryParserService(openai);
      const result = await parser.parse("Show me Alice's JIRA tickets", ['alice']);

      expect(result.intent).toBe('jira_only');
    }, 15000);

    test('classifies github_only intent and this_week timeframe', async () => {
      const parser = new QueryParserService(openai);
      const result = await parser.parse("What has Bob committed this week?", ['alice', 'bob']);

      expect(result.intent).toBe('github_only');
      expect(result.timeframe).toBe('this_week');
    }, 15000);
  });

  describe('ResponseStreamService', () => {
    test('streams non-empty text from delta events', async () => {
      const streamer = new ResponseStreamService(openai);

      const chunks = [];
      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn((data) => chunks.push(data)),
        end: jest.fn(),
      };

      await streamer.stream(mockRes, {
        memberEntry: { displayName: 'Alice' },
        activityData: {
          jira: {
            issues: [{ key: 'PROJ-1', summary: 'Build login flow', status: 'In Progress', priority: 'High', project: 'Platform', updatedAt: '2026-05-01' }],
          },
          github: null,
        },
        warnings: [],
        originalQuery: 'What is Alice working on?',
      });

      const events = chunks
        .map((c) => JSON.parse(c.replace(/^data: /, '').trim()))
        .filter((e) => e.type === 'delta');

      const text = events.map((e) => e.text).join('');
      expect(text.length).toBeGreaterThan(20);
    }, 30000);

    test('emits a done event at the end of the stream', async () => {
      const streamer = new ResponseStreamService(openai);
      const events = [];

      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn((data) => events.push(JSON.parse(data.replace(/^data: /, '').trim()))),
        end: jest.fn(),
      };

      await streamer.stream(mockRes, {
        memberEntry: { displayName: 'Bob' },
        activityData: { jira: null, github: { commits: [], openPRs: [], activeRepos: [] } },
        warnings: ['jira: auth failed'],
        originalQuery: 'What is Bob doing?',
      });

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent.sources).toHaveProperty('jira', false);
      expect(doneEvent.sources).toHaveProperty('github', true);
      expect(doneEvent.sources.warnings).toContain('jira: auth failed');
    }, 30000);
  });
}, 60000);
