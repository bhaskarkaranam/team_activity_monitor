const ActivityService = require('../../src/services/ActivityService');

const makeProvider = (name, returnValue) => ({
  name,
  fetchActivity: jest.fn().mockResolvedValue(returnValue),
});

const makeFailingProvider = (name, error = new Error('timeout')) => ({
  name,
  fetchActivity: jest.fn().mockRejectedValue(error),
});

const member = {
  jira: { accountId: 'jira-id' },
  github: { username: 'gh-user' },
};

describe('ActivityService.fetchForMember', () => {
  test('calls all eligible providers and returns merged data', async () => {
    const jira = makeProvider('jira', { issues: [{ key: 'P-1' }] });
    const github = makeProvider('github', { commits: [] });
    const service = new ActivityService([jira, github]);

    const { data, warnings } = await service.fetchForMember(member, 'general_activity');

    expect(jira.fetchActivity).toHaveBeenCalledWith(member.jira);
    expect(github.fetchActivity).toHaveBeenCalledWith(member.github);
    expect(data.jira.issues).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  test('only calls JIRA provider on jira_only intent', async () => {
    const jira = makeProvider('jira', { issues: [] });
    const github = makeProvider('github', { commits: [] });
    const service = new ActivityService([jira, github]);

    await service.fetchForMember(member, 'jira_only');

    expect(jira.fetchActivity).toHaveBeenCalled();
    expect(github.fetchActivity).not.toHaveBeenCalled();
  });

  test('only calls GitHub provider on github_only intent', async () => {
    const jira = makeProvider('jira', { issues: [] });
    const github = makeProvider('github', { commits: [] });
    const service = new ActivityService([jira, github]);

    await service.fetchForMember(member, 'github_only');

    expect(jira.fetchActivity).not.toHaveBeenCalled();
    expect(github.fetchActivity).toHaveBeenCalled();
  });

  test('skips provider if member has no identity for it', async () => {
    const jira = makeProvider('jira', { issues: [] });
    const github = makeProvider('github', { commits: [] });
    const service = new ActivityService([jira, github]);
    const memberNoGithub = { jira: { accountId: 'id' }, github: null };

    await service.fetchForMember(memberNoGithub, 'general_activity');

    expect(github.fetchActivity).not.toHaveBeenCalled();
  });

  test('returns null data and warning for a failing provider', async () => {
    const jira = makeProvider('jira', { issues: [{ key: 'P-1' }] });
    const github = makeFailingProvider('github');
    const service = new ActivityService([jira, github]);

    const { data, warnings } = await service.fetchForMember(member, 'general_activity');

    expect(data.jira).not.toBeNull();
    expect(data.github).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('github');
  });

  test('handles all providers failing gracefully', async () => {
    const jira = makeFailingProvider('jira');
    const github = makeFailingProvider('github');
    const service = new ActivityService([jira, github]);

    const { data, warnings } = await service.fetchForMember(member, 'general_activity');

    expect(data.jira).toBeNull();
    expect(data.github).toBeNull();
    expect(warnings).toHaveLength(2);
  });
});
