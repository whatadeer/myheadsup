# MyHeadsUp

MyHeadsUp is a personal dashboard for self-hosted GitLab. It lets you save the groups and projects you care about, then keeps the useful status in one place: open issues, merge requests, schedules, pipelines, Jira links, and optional SonarQube health.

## Highlights

- Save top-level GitLab groups or projects and keep them on one dashboard
- Expand groups into nested subgroup and project views
- Track open issues and dependency-dashboard vulnerability counts
- See merge request status, including unassigned, approval, and rebase-needed signals
- Review latest pipeline status and 14-day pipeline activity
- Inspect pipeline schedules and trigger upcoming schedules with **Run now**
- Attach Jira project keys and SonarQube project keys at the source or per-project level
- Use automatic refresh, manual refresh, and browser-stored fallback config
- Install the app like a lightweight web app with the included manifest and service worker

## Configuration

Create a `.env.local` file in the project root:

```bash
GITLAB_BASE_URL=https://gitlab.example.com
GITLAB_TOKEN=your-personal-access-token
JIRA_BASE_URL=https://jira.example.com
SONARQUBE_BASE_URL=https://sonarqube.example.com
SONARQUBE_TOKEN=your-sonarqube-token
```

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `GITLAB_BASE_URL` | Yes | Root URL for your GitLab instance, without `/api/v4` |
| `GITLAB_TOKEN` | Yes | Personal access token with access to the groups and projects you want to browse |
| `JIRA_BASE_URL` | No | Enables Jira project links when Jira keys are saved |
| `SONARQUBE_BASE_URL` | No | Must be paired with `SONARQUBE_TOKEN` |
| `SONARQUBE_TOKEN` | No | Must be paired with `SONARQUBE_BASE_URL` |
| `ACCESS_LOGS` | No | Controls request logging; defaults to enabled in production |
| `DEBUG_DASHBOARD` | No | Enables verbose backend dashboard debug logging |
| `DEBUG_MODE` | No | Shows a UI panel with effective GitLab, Jira, and SonarQube base URLs |

### Browser-stored fallback config

If the server starts without GitLab credentials, the home page shows a setup form instead of live data. You can save GitLab settings there and optionally add Jira and SonarQube settings for that browser only.

That fallback is useful for local or self-hosted setups, but server environment variables are still the safer option because browser-stored tokens remain accessible to that browser profile.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Build the production app |
| `npm run start` | Start the production server after a build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run the Vitest suite |

## Running in Docker

The repository includes a production Dockerfile that uses Next.js standalone output.

```bash
docker build -t myheadsup .
docker run --rm -p 3000:3000 \
  --env-file .env.local \
  -v myheadsup-data:/app/data \
  myheadsup
```

Saved sources live under `/app/data`, so mount that path if you want them to survive container restarts.

## Running with Compose

```bash
docker compose --env-file .env.local up -d --build
```

The checked-in `compose.yaml` starts:

1. `myheadsup`
2. `traefik`

Traefik routes `http://myheadsup.localhost` to the app and exposes its dashboard at `http://localhost:8080`. Because the route uses `.localhost`, you do not need a hosts file entry.

## Usage

1. Configure GitLab access with server env vars or browser-stored settings.
2. Search accessible GitLab groups and projects from the combined picker, or paste a saved source query directly.
3. Add a root group or project to the dashboard.
4. For group sources, optionally exclude nested groups or projects.
5. Optionally attach Jira project keys or SonarQube project keys.
6. Use **Refresh now** or enable **Auto refresh** to keep the dashboard updated.

Saved sources are written to `data\sources.json`, which is ignored by git.

## Saved source query format

The source form can build a query for you, but you can also paste and edit the saved definition directly.

Example:

```text
Add Group platform/team
Without Groups platform/team/archive
Without Projects platform/team/old-service
With Jira Project platform/team/api = OPS, PLAT
With SonarQube Project platform/team/web = platform-team-web
```

Project sources can use direct Jira and SonarQube lines:

```text
Add Project platform/api
With Jira OPS
With SonarQube platform-api
```

Rules:

- `Add Group ...`, `Add Project ...`, or `Add Source ...` must be the first line
- `Without Group(s) ...` and `Without Project(s) ...` apply only to saved group sources
- `With Jira ...` and `With SonarQube ...` apply only to saved project sources
- `With Jira Project ... = ...` and `With SonarQube Project ... = ...` apply only to saved group sources

## Refresh behavior

The dashboard performs an initial live load when data can be fetched. After that:

- automatic refresh is off by default
- auto refresh runs every 90 seconds when enabled
- manual refresh is available on demand with a short cooldown
- background refresh preserves the last successful data if GitLab has a temporary issue

## Notes

- Jira integration is link-only; MyHeadsUp does not authenticate against Jira
- SonarQube is optional and ignored when no matching project key is configured
- The service worker caches the app shell and static assets, but not API responses
