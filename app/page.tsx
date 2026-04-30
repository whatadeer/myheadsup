import { HomeContent } from "@/components/home-content";
import { getGitLabConfigError } from "@/lib/gitlab";
import { readSources } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const savedSources = await readSources();
  const configError = getGitLabConfigError();

  return (
    <HomeContent
      initialDashboards={[]}
      key={`${configError ?? "configured"}:${savedSources.map((source) => `${source.id}:${source.query}`).join("|")}`}
      savedSources={savedSources}
      serverConfigError={configError}
    />
  );
}

