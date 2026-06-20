export type BlurWebhookStage = "detect" | "track" | "cog";

// Signed-URL lifetime — must outlive the whole pipeline.
export const SIGNED_URL_TTL = 60 * 30;

// Replicate calls back here when a stage finishes. It MUST be an absolute,
// publicly-reachable HTTPS URL. Resolution order:
//   1. NEXT_PUBLIC_APP_URL (explicit; scheme prepended if missing)
//   2. Vercel's injected deployment host (prod + preview deploys)
//   3. localhost (dev — webhook won't be delivered, but create won't 422)
function webhookBase(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return /^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`;
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (host) return `https://${host}`;
  return "http://localhost:3000";
}

function webhookUrl(jobId: string, stage: BlurWebhookStage): string {
  return `${webhookBase()}/api/blur/webhook?job=${jobId}&stage=${stage}`;
}

export function hasDeliverableWebhook() {
  return /^https:\/\//i.test(webhookUrl("healthcheck", "detect"));
}

// Replicate validates the webhook at create time and 422s on a non-HTTPS URL
// (e.g. http://localhost during local dev). When the base isn't HTTPS, omit the
// webhook and let polling/reconcile or the dev driver advance the job.
export function webhookFields(jobId: string, stage: BlurWebhookStage) {
  const url = webhookUrl(jobId, stage);
  if (!/^https:\/\//i.test(url)) return {} as const;
  const webhookEvents: Array<"completed"> = ["completed"];
  return { webhook: url, webhook_events_filter: webhookEvents };
}

export function usingCog(): boolean {
  return Boolean(process.env.REPLICATE_VEIL_AUTOBLUR_VERSION);
}
