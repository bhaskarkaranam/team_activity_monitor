const express = require('express');
const { ValidationError, MemberNotFoundError } = require('../errors/AppError');

const router = express.Router();

module.exports = (teamRepo, queryParser, activityService, responseStreamer) => {
  router.get('/team', (_req, res) => {
    res.json({ members: teamRepo.getAllNames() });
  });

  router.post('/chat', async (req, res, next) => {
    const { message } = req.body ?? {};
    const log = res.locals.log;

    if (!message?.trim()) return next(new ValidationError('Message cannot be empty'));

    log.info({ userMessage: message.slice(0, 120) }, 'Chat request received');

    try {
      // --- Phase 1: Parse query (JSON error phase, SSE not started yet) ---
      const parsed = await queryParser.parse(message, teamRepo.getAllAliases());
      log.debug({ parsed }, 'Query parsed');

      // --- Phase 2: Fetch data (branch based on intent) ---
      let memberEntry = null;
      let activityData = {};
      let warnings = [];

      if (parsed.intent === 'issue_detail') {
        if (!parsed.issueKey) return next(new ValidationError('Could not identify a JIRA issue key in your question'));
        log.debug({ issueKey: parsed.issueKey }, 'Fetching issue detail');
        const issueDetail = await activityService.fetchIssueDetail(parsed.issueKey);
        activityData = { issueDetail };
      } else {
        memberEntry = teamRepo.resolve(parsed.memberName);
        if (!memberEntry) return next(new MemberNotFoundError(parsed.memberName, teamRepo.getAllNames()));
        log.debug({ member: memberEntry.displayName, intent: parsed.intent }, 'Member resolved');
        ({ data: activityData, warnings } = await activityService.fetchForMember(memberEntry, parsed.intent));
      }

      // --- Phase 3: Stream OpenAI response via SSE ---
      await responseStreamer.stream(res, { memberEntry, activityData, warnings, originalQuery: message });
    } catch (err) {
      // If SSE headers already sent, errors must go through the stream
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        return res.end();
      }
      next(err);
    }
  });

  return router;
};
