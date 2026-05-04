#!/usr/bin/env node
/**
 * Fetches team members from JIRA and GitHub, matches them by email,
 * and writes the result to config/team.json.
 *
 * Usage:
 *   npm run sync-team
 *   npm run sync-team -- --org your-github-org   (to include GitHub org members)
 */
const config = require('../../config/config');
const TeamSyncService = require('../services/TeamSyncService');

const githubOrg = (() => {
  const flag = process.argv.indexOf('--org');
  return flag !== -1 ? process.argv[flag + 1] : process.env.GITHUB_ORG ?? null;
})();

async function main() {
  const syncer = new TeamSyncService({
    jiraConfig: config.jira,
    githubConfig: config.github,
    teamJsonPath: config.teamJsonPath,
  });

  const members = await syncer.sync(githubOrg);

  console.log(`\nSynced ${members.length} team member(s):\n`);
  for (const m of members) {
    const systems = [m.jira && 'JIRA', m.github && 'GitHub'].filter(Boolean).join(', ');
    const unmatched = (m.jira && !m.github) || (!m.jira && m.github) ? ' ⚠ unmatched' : '';
    console.log(`  ${m.displayName} (${systems})${unmatched}`);
  }

  if (members.some((m) => (m.jira && !m.github) || (!m.jira && m.github))) {
    console.log('\n⚠  Some members could not be matched across systems.');
    console.log('   This happens when GitHub emails are private or names differ.');
    console.log('   Edit config/team.json to add the missing identities manually.\n');
  }
}

main().catch((err) => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
