export type AppEnvironment = "development" | "staging" | "production";

/**
 * Select the Rubicon gateway URL from the same APP_ENV profile names as the
 * gateway service. Deployed app instances never fall back to another profile.
 */
export function gatewayUrlForEnvironment(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const appEnv = parseAppEnvironment(env.APP_ENV);
  if (appEnv === "development") return env.RUBICON_GATEWAY_URL;
  return env[`${appEnv.toUpperCase()}_GATEWAY_BASE_URL`];
}

export function parseAppEnvironment(value: string | undefined): AppEnvironment {
  if (value === "staging" || value === "production") return value;
  return "development";
}
