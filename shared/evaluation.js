import { createHash } from 'node:crypto';
export function evaluate(policy, { flagKey, environmentId, subject }) {
  if (!policy || !policy.enabled) return { value: false, reason: 'disabled' };
  if (policy.allowlist.includes(subject)) return { value: true, reason: 'allowlist' };
  const bucket =
    parseInt(
      createHash('sha256')
        .update(JSON.stringify([environmentId, flagKey, subject]))
        .digest('hex')
        .slice(0, 8),
      16,
    ) % 10000;
  return { value: bucket < Math.round(policy.percentage * 100), reason: 'rollout', bucket };
}
