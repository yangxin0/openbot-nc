const ACCOUNT_SETTINGS =
  /^(?:STRIPE_|BOAT_|HOSTED_SERVERS_|HOSTED_SERVER_TEMPLATE$|EMAIL_|SITE_REPORT_HASH_SECRET$|COMPANY_SIGN_IN_SECRET$|SKILLS_ADMIN_TOKEN$|APNS_|FCM_|GITHUB_APP_|GITHUB_WEBHOOK_SECRET$|SLACK_|DISCORD_|TELEGRAM_|REMOTE_TICKET_|REMOTE_AUTH_WEBHOOK_SECRET$|MEDIA_API_)/u;
const SERVICE_SECRETS = ["REMOTE_SESSION_SECRET", "TURN_SHARED_SECRET", "REMOTE_METRICS_TOKEN"] as const;

function withoutDecryptionKeys(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith("DOTENV_")));
}

export function developmentChildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child = withoutDecryptionKeys(environment);
  delete child.OPENBOT_DEV_SLACK_SIGNING_SECRET;
  for (const key of Object.keys(child)) {
    if (ACCOUNT_SETTINGS.test(key)) delete child[key];
  }
  for (const key of SERVICE_SECRETS) delete child[key];
  return child;
}
