import { defineRailway, project, service } from "railway/iac";

// Manages only the `web` service's build/deploy settings. `partial` keeps everything else in the project
// (Postgres and its volume) out of reach: a whole-project file would delete resources it doesn't list.
// Variables stay in the Railway dashboard/CLI.
export const partial = "web";

export default defineRailway(() => {
  const web = service("web", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { "us-east4-eqdc4a": 1 },
  });

  return project("our-trip", {
    variables: { managed: false },
    resources: [web],
  });
});
