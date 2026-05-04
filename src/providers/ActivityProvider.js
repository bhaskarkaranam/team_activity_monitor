class ActivityProvider {
  get name() {
    throw new Error('ActivityProvider.name must be implemented by subclass');
  }

  // memberIdentity shape is provider-specific (e.g. { accountId } for JIRA, { username } for GitHub)
  async fetchActivity(memberIdentity) {
    throw new Error('ActivityProvider.fetchActivity must be implemented by subclass');
  }
}

module.exports = ActivityProvider;
