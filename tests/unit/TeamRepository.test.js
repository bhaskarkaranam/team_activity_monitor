const fs = require('fs');
const path = require('path');
const TeamRepository = require('../../src/repositories/TeamRepository');

const FIXTURE = {
  members: [
    {
      displayName: 'Alice Johnson',
      aliases: ['alice', 'alice johnson', 'aj'],
      jira: { accountId: 'jira-alice' },
      github: { username: 'alice-dev' },
    },
    {
      displayName: 'Bob Smith',
      aliases: ['bob', 'bob smith'],
      jira: { accountId: 'jira-bob' },
      github: null,
    },
  ],
};

const tmpPath = path.join(__dirname, '__team_fixture__.json');
let repo;

beforeAll(() => {
  fs.writeFileSync(tmpPath, JSON.stringify(FIXTURE));
  repo = new TeamRepository(tmpPath);
});

afterAll(() => fs.unlinkSync(tmpPath));

describe('TeamRepository.resolve', () => {
  test('resolves by exact display name', () => {
    expect(repo.resolve('Alice Johnson').displayName).toBe('Alice Johnson');
  });

  test('resolves by simple alias', () => {
    expect(repo.resolve('alice').displayName).toBe('Alice Johnson');
  });

  test('resolves by informal alias', () => {
    expect(repo.resolve('aj').displayName).toBe('Alice Johnson');
  });

  test('is case-insensitive', () => {
    expect(repo.resolve('ALICE').displayName).toBe('Alice Johnson');
    expect(repo.resolve('Alice Johnson').displayName).toBe('Alice Johnson');
  });

  test('trims whitespace before matching', () => {
    expect(repo.resolve('  bob  ').displayName).toBe('Bob Smith');
  });

  test('returns null for unknown name', () => {
    expect(repo.resolve('Zara')).toBeNull();
  });
});

describe('TeamRepository.getAllNames', () => {
  test('returns all display names', () => {
    expect(repo.getAllNames()).toEqual(['Alice Johnson', 'Bob Smith']);
  });
});

describe('TeamRepository.getAllAliases', () => {
  test('returns all aliases from all members', () => {
    const aliases = repo.getAllAliases();
    expect(aliases).toContain('alice');
    expect(aliases).toContain('aj');
    expect(aliases).toContain('bob smith');
  });
});
