const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const { OpenAI } = require('openai');

const config = require('../config/config');
const logger = require('./logger');
const TeamRepository = require('./repositories/TeamRepository');
const JiraProvider = require('./providers/JiraProvider');
const GithubProvider = require('./providers/GithubProvider');
const ActivityService = require('./services/ActivityService');
const QueryParserService = require('./services/QueryParserService');
const ResponseStreamService = require('./services/ResponseStreamService');
const TeamSyncService = require('./services/TeamSyncService');
const chatRoutes = require('./routes/chat');

const app = express();

// --- Dependency wiring (all construction in one place) ---
const openai = new OpenAI({ apiKey: config.openai.apiKey });
const teamRepo = new TeamRepository(config.teamJsonPath);
const activityService = new ActivityService([
  new JiraProvider(config.jira),
  new GithubProvider(config.github),
]);
const queryParser = new QueryParserService(openai);
const responseStreamer = new ResponseStreamService(openai);

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use((_req, res, next) => {
  res.locals.log = logger.child({ requestId: crypto.randomUUID() });
  next();
});

// --- Routes ---
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.use('/api', chatRoutes(teamRepo, queryParser, activityService, responseStreamer));

// --- Error middleware ---
// Must be last; maps AppError subclasses to HTTP responses and logs appropriately
app.use((err, req, res, next) => {
  const log = res.locals.log ?? logger;
  const statusCode = err.statusCode ?? 500;

  if (err.isOperational === false) {
    log.error({ stack: err.stack, context: err.context }, 'Unexpected non-operational error');
  } else {
    log.warn({ errorCode: err.code, statusCode, context: err.context }, err.message);
  }

  res.status(statusCode).json({ error: err.message, code: err.code ?? 'INTERNAL_ERROR' });
});

async function bootstrap() {
  const syncer = new TeamSyncService({
    jiraConfig: config.jira,
    githubConfig: config.github,
    teamJsonPath: config.teamJsonPath,
  });

  try {
    const members = await syncer.sync(config.githubOrg);
    logger.info({ memberCount: members.length }, 'Team sync complete');
  } catch (err) {
    // Sync failure is non-fatal — server starts with whatever is already in team.json
    logger.warn({ err: err.message }, 'Team sync failed on startup, using existing team.json');
  }

  app.listen(config.port, () => logger.info({ port: config.port }, 'Team Activity Monitor started'));
}

bootstrap();

module.exports = app;
