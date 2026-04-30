import { LoadingStatus } from "@/components/loading-status";

export default function Loading() {
  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Self-hosted GitLab</span>
          <h1>MyHeadsUp</h1>
          <p>
            Loading your saved dashboard so the latest groups, projects, merge
            requests, and pipeline details can stream in.
          </p>
        </div>
      </section>

      <section className="panel empty-state">
        <LoadingStatus
          description="Retrieving your saved sources and building the live dashboard."
          stages={[
            "Opening the dashboard shell.",
            "Loading saved sources.",
            "Fetching GitLab group and project details.",
            "Finalizing the initial view.",
          ]}
          title="Loading dashboard"
        />
      </section>
    </main>
  );
}
