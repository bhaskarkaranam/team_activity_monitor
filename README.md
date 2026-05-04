# Team Activity Monitor

A chatbot that answers questions about your team's work by pulling live data from JIRA and GitHub, then generating a conversational summary via OpenAI GPT-3.5.

---

## Setup

**1. Install dependencies**
```bash
npm install
```

**2. Configure environment**
```bash
cp .env.example .env
# Fill in your API keys in .env
```

**3. Run**
```bash
npm run dev     # development (hot reload, nodemon)
npm start       # production
```

Open `http://localhost:3000` and start asking questions.

---

## Example queries

```
"What is Alice working on these days?"
"Show me Bob's JIRA tickets"
"What has Alice committed this week?"
"What is the latest on PROJ-123?"
```

---

## How it works

### 1. Server startup — team registry is built once

When the server starts, before it accepts any requests, it automatically runs a team sync:

```
Server starts
  → TeamSyncService runs
      → GET /rest/api/3/users/search       (all active JIRA users)
      → GET /orgs/{org}/members            (GitHub org members, if GITHUB_ORG is set)
      → GET /users/{username}              (each member's GitHub profile for email)
  → Matches JIRA users ↔ GitHub users by email, falls back to name
  → Writes config/team.json  { displayName, aliases, jira: { accountId }, github: { username } }
  → Server begins listening on port 3000
```

`config/team.json` is the team registry. It maps human-readable names and aliases to the API identifiers needed to query each system (`accountId` for JIRA, `username` for GitHub).

On every incoming chat request, `TeamRepository` reads this file from disk and resolves the member name extracted from the user's question. The file is never fetched from APIs again during the request — only the targeted member's activity data is fetched. Editing `team.json` takes effect immediately without a restart.

If sync fails at startup (bad credentials, network issue), the server still starts using whatever was last written to `team.json`.

---

### 2. User message received — HTTP POST

The browser sends the user's message as a standard HTTP POST:

```
POST /api/chat
Content-Type: application/json

{ "message": "What is Bhaskar working on?" }
```

No response is sent yet. The server begins processing through three sequential phases before any bytes go back to the browser.

---

### 3. Phase 1 — Intent and member identification via OpenAI

The raw user message is sent to **GPT-3.5-turbo** using OpenAI's **function calling** (tool use) feature.

**Why function calling?** Natural language questions are unpredictable. "What's AJ been up to in payments?" needs to reliably extract `memberName: "aj"` and `intent: "jira_only"`. Function calling forces OpenAI to return a strict JSON schema rather than free text, so there's no string parsing on our side.

**The tool schema sent to OpenAI:**
```json
{
  "name": "extract_query_info",
  "parameters": {
    "memberName": "string — the name or alias mentioned, lowercased",
    "issueKey":   "string — JIRA issue key if asking about a specific issue e.g. PROJ-123",
    "intent":     "general_activity | jira_only | github_only | issue_detail",
    "timeframe":  "today | this_week | recent | this_month"
  }
}
```

**System prompt sent alongside:**
```
You are a query parser for a team activity monitor.
Extract the member name and intent from the user's question.
Known team aliases: alice, bhaskar, bob, ...
Always call extract_query_info.
```

OpenAI returns a structured result like:
```json
{ "memberName": "bhaskar", "intent": "general_activity", "timeframe": "recent" }
```

`TeamRepository` then resolves `"bhaskar"` against the aliases in `team.json` to get the full member entry including their JIRA `accountId` and GitHub `username`.

---

### 4. Phase 2 — Provider API calls

Once the member identity is resolved, `ActivityService` fans out to the relevant providers in parallel using `Promise.allSettled` (so one provider failing does not block the other).

Which providers are called depends on the detected intent:
- `general_activity` → JIRA + GitHub
- `jira_only` → JIRA only
- `github_only` → GitHub only
- `issue_detail` → JIRA only (single issue detail)

#### JIRA APIs — `src/providers/JiraProvider.js`

| API | When called | What it returns |
|---|---|---|
| `GET /rest/api/3/search?jql=assignee={accountId} AND statusCategory != Done ORDER BY updated DESC&maxResults=10` | `general_activity`, `jira_only` | Active tickets with key, summary, status, priority, project, updatedAt |
| `GET /rest/api/3/issue/{issueKey}?fields=summary,status,assignee,priority,updated` | `issue_detail` | Current state of a specific issue |
| `GET /rest/api/3/issue/{issueKey}/changelog` | `issue_detail` | Field change history (status transitions, reassignments) |
| `GET /rest/api/3/issue/{issueKey}/comment?orderBy=-created&maxResults=3` | `issue_detail` | Most recent 3 comments |
| `GET /rest/api/3/users/search` | Startup team sync only | All active JIRA users |

Auth: `Authorization: Basic base64(email:apiToken)`

#### GitHub APIs — `src/providers/GithubProvider.js`

| API | When called | What it returns |
|---|---|---|
| `GET /search/commits?q=author:{username} author-date:>={7daysAgo}&per_page=10` | `general_activity`, `github_only` | Recent commits with sha, message, repo, date |
| `GET /search/issues?q=is:pr author:{username} is:open&per_page=10` | `general_activity`, `github_only` | Open pull requests with title, repo, url |
| `GET /users/{username}/events/public?per_page=30` | `general_activity`, `github_only` | Recent activity events to derive active repos |
| `GET /orgs/{org}/members` | Startup team sync only | All org members |
| `GET /users/{username}` | Startup team sync only | Member profile (name + email for matching) |

Auth: `Authorization: Bearer {GITHUB_TOKEN}`

Provider failures are non-fatal. If JIRA returns a 401 or GitHub hits a rate limit, the failure is recorded as a warning and the response is generated from whichever data is available.

---

### 5. Phase 3 — Response construction and streaming

Once the API data is in hand, `ResponseStreamService` builds a prompt and calls **GPT-3.5-turbo** with `stream: true`.

**System prompt:**
```
You are a helpful team activity assistant.
Summarize what a team member is working on using JIRA and GitHub data.
- Be concise (3-5 sentences)
- Cite JIRA ticket keys (e.g. PROJ-123: summary)
- Mention open PR titles if relevant
- If a data source is unavailable, briefly note it
- Do not invent information
```

**User prompt constructed from API data:**
```
User asked: "What is Bhaskar working on?"

=== Bhaskar's JIRA (active tickets) ===
[{ key, summary, status, priority, project, updatedAt }, ...]

=== Bhaskar's GitHub (last 7 days) ===
Commits: [{ sha, message, repo, date }, ...]
Open PRs: [{ number, title, repo, url }, ...]
Active repos: [org/repo1, org/repo2]
```

The raw API data and the original user question together form the full context. OpenAI's job is only to narrate it — it cannot invent data because everything in the prompt comes directly from the APIs.

---

### 6. Why SSE instead of a standard HTTP response

The user message is sent via HTTP POST. Once the JIRA and GitHub data is ready, the server switches the response to an SSE stream — the AI-generated answer arrives word-by-word as OpenAI produces it, rather than waiting for the full response before rendering anything.

Errors before streaming starts (unknown member, empty message) are returned as standard JSON HTTP error responses. Errors after streaming starts are delivered as a `{ "type": "error" }` SSE event.

---

## Project structure

```
src/
  server.js                    — app setup, dependency wiring, bootstrap (team sync on start)
  providers/
    ActivityProvider.js        — abstract base class (Strategy pattern)
    JiraProvider.js            — JIRA REST API integration
    GithubProvider.js          — GitHub REST API integration
  services/
    TeamSyncService.js         — fetches users from JIRA + GitHub, writes team.json at startup
    QueryParserService.js      — OpenAI function calling → extracts member + intent
    ActivityService.js         — orchestrates provider calls based on intent
    ResponseStreamService.js   — OpenAI streaming → SSE to browser
  repositories/
    TeamRepository.js          — reads team.json, resolves names/aliases per request
  routes/
    chat.js                    — POST /api/chat handler (3-phase pipeline)
  errors/
    AppError.js                — typed error hierarchy
  logger.js                    — pino structured logger (pretty in dev, JSON in prod)
config/
  config.js                    — loads and validates env vars
  team.json                    — generated team registry (written by TeamSyncService)
public/
  index.html                   — chat UI
  script.js                    — SSE stream reader, DOM updates
tests/
  unit/                        — mocked tests, no network calls required
  integration/                 — real API calls (requires populated .env)
```

---

## Tests

```bash
npm test                  # unit tests (no API keys needed)
npm run test:integration  # real API calls (requires .env populated)
```

For integration tests, also set in `.env`:
```
TEST_JIRA_ACCOUNT_ID=<a real accountId>
TEST_GITHUB_USERNAME=<a real GitHub username>
```

---

## Production considerations

### Authentication tokens per provider

Each provider uses a different token type with different security properties. Here is how each is handled today and what it should move to in production.

**JIRA**
Currently uses HTTP Basic auth — the user's email and API token are base64-encoded and sent as the `Authorization` header on every request. The API token is a long-lived credential tied to a personal account; if it leaks or the account is deactivated, all JIRA calls break.

In production this should be replaced with **Atlassian OAuth 2.0 (3-Legged OAuth)**. The app gets a scoped access token (`read:jira-work`, `read:jira-user`) that expires and can be revoked independently of the user account.

**GitHub**
Currently uses a personal access token (PAT) sent as `Authorization: Bearer`. A PAT is tied to one person's GitHub account, has broad scope, and never expires unless manually rotated.

In production this should be replaced with a **GitHub App**. A GitHub App is installed at the org level, has fine-grained permissions per repository, and issues short-lived installation tokens (1 hour TTL) via `POST /app/installations/{id}/access_tokens`. If the token leaks it expires on its own, and access can be revoked at the org level without touching any personal account.

**OpenAI**
OpenAI has no OAuth option. The API key should be stored in a secrets manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault) and fetched at runtime rather than read from a `.env` file on disk. `config/config.js` would call the secrets manager SDK instead of `process.env`. Key rotation then happens in the secrets manager with no redeploy required.

---

### Rate limiting

The `/api/chat` endpoint triggers up to three external API calls (JIRA, GitHub, OpenAI) per request. Without rate limiting, a burst of requests can exhaust OpenAI token quotas, hit GitHub's search API rate limits (10 requests/min for unauthenticated, 30/min for authenticated), or incur unexpected cost.

Two layers of rate limiting should be added in production:

**Inbound — protect the service**
Use `express-rate-limit` on `POST /api/chat` to cap requests per IP or per user session. A reasonable default for a team tool is 20 requests per minute per user. Requests over the limit receive a `429` response before any external call is made.

**Outbound — handle provider limits**
GitHub's search API returns a `403` with `X-RateLimit-Remaining: 0` when the limit is hit. The `GithubProvider` already maps this to a `ProviderRateLimitError` with the `retryAfter` value from the response header. In production, a retry layer with exponential backoff should sit in front of provider calls so transient rate limit hits are retried transparently rather than surfaced as errors.

---

### Team registry in production — DB + cache + periodic sync

Currently `TeamSyncService` writes the team registry to a local `config/team.json` file at startup, and `TeamRepository` reads that file on every request. This works for a single process but breaks under two conditions:

- **Multiple pods/instances** — each instance writes its own local copy of `team.json`. If the sync runs at different times per pod, instances have inconsistent views of the team.
- **New team members** — the registry only updates when the server restarts. A person who joins mid-day is invisible until the next restart.

**Target architecture in production:**

```
Startup + periodic cron
  TeamSyncService
    → fetches JIRA users + GitHub org members
    → merges and writes to PostgreSQL (or any relational DB)
        table: team_members { id, display_name, aliases[], jira_account_id, github_username, updated_at }

Every request (all pods)
  TeamRepository
    → reads from Redis cache (TTL: 30 minutes)
    → on cache miss: queries DB, repopulates cache
    → all pods share the same Redis → always consistent
```

The sync runs on a scheduled cron (every 2-4 hours) rather than only at startup. It writes to the DB, then invalidates the Redis cache so the next request across any pod picks up the fresh data. No restart needed for team changes to propagate.

`TeamRepository` is the only file that needs to change — its `_load()` method switches from `fs.readFileSync` to a Redis `GET` with a DB fallback. The rest of the application (route handler, `ActivityService`, `QueryParserService`) is unaffected because they all go through `TeamRepository` and never touch the storage layer directly.

---

## Adding a new data source

Create a class extending `ActivityProvider` in `src/providers/`, implement `get name()` and `fetchActivity(memberIdentity)`, then register it in `src/server.js`:

```js
const activityService = new ActivityService([
  new JiraProvider(config.jira),
  new GithubProvider(config.github),
  new LinearProvider(config.linear),  // ← add here
]);
```

No other files need to change.
