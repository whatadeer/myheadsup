# MyHeadsUp

MyHeadsUp is a personal dashboard for a self-hosted GitLab instance. It gives
you a compact overview of saved groups and projects, including:

- open issues
- open merge requests
- pipeline schedules
- latest pipeline status

Saved group entries expand into nested subgroup and project views.

## Configuration

Create `C:\Users\cdroz\Projects\MyHeadsUp\.env.local` with:

```bash
GITLAB_BASE_URL=https://your.gitlab.example.com
GITLAB_TOKEN=your-personal-access-token
SONARQUBE_BASE_URL=https://sonarqube.example.com
SONARQUBE_TOKEN=your-sonarqube-token
```

`GITLAB_BASE_URL` should be the root URL of your self-hosted GitLab without
`/api/v4`.

SonarQube is optional. When configured, enter the exact SonarQube project key
for a saved project, or edit per-project SonarQube keys directly inside a saved
group view. Those project SonarQube mappings are written into the saved source
query so they load back with the group.

## Running locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Running in Docker

The app now ships with a production Dockerfile that uses Next.js standalone
output.

```bash
docker build -t myheadsup .
docker run --rm -p 3000:3000 \
  --env-file .env.local \
  -v myheadsup-data:/app/data \
  myheadsup
```

The `data` directory stores your saved dashboard sources, so mount `/app/data`
to keep them across container restarts.

If you prefer explicit flags, `docker run -e ...` still works. `.env.local`
stays outside the image build context, so secrets are injected only when the
container starts.

## Running with Compose

```bash
docker compose --env-file .env.local up -d --build
```

The checked-in `compose.yaml` includes a development Traefik service, routes
`http://myheadsup.local` to MyHeadsUp, exposes the Traefik dashboard at
`http://localhost:8080`, and mounts `./data` to `/app/data` so saved sources
persist locally.

Add this local hosts entry before starting the stack:

```text
127.0.0.1 myheadsup.local
```

On Windows, edit `C:\Windows\System32\drivers\etc\hosts` as Administrator.

## Browser setup fallback

If the app starts without `GITLAB_BASE_URL` and `GITLAB_TOKEN`, the home page
now shows a setup screen. You can enter the GitLab base URL and token in the
UI, optionally add SonarQube settings, and those values are saved in your
browser storage for that browser only.

That browser-stored setup is a fallback for local/self-hosted use. Server
environment variables remain the preferred option because browser-stored tokens
are less secure.

## Usage

1. Search the accessible GitLab groups and projects from the combined combobox.
2. Pick the root result you want, or enter a full path like `platform/backend` or a numeric GitLab ID.
3. For group queries, optionally add excluded groups and projects from the exclusion picker.
4. Optionally enter an exact SonarQube project key for that project.
5. Add the source to the dashboard.

The add-source form builds and saves a simple query-language summary such as:

```text
Add Group platform/team
Without Groups platform/team/archive
Without Projects platform/team/old-service
```

Excluded groups remove their full subtree from the saved dashboard source.

When you save SonarQube keys for projects inside a group, the saved query grows
with lines like:

```text
With SonarQube Project platform/team/api = platform-team-api
```

The add-source pickers query the GitLab API with your configured token and
caches recent suggestion results briefly in the app process.

Saved sources are stored locally in `data\sources.json`, which is ignored by
git.
