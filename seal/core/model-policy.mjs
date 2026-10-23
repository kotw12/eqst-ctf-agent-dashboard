// Codex model capability cache, client 0.163.0, observed 2026-10-20:
// Sol/Luna context_window=272000, max_context_window=872000, effective=95%.
// These are advertised/configured limits, not a full-length inference benchmark.
export const DEFAULT_MODEL = 'gpt-6-sol';
export const LIGHTWEIGHT_MODEL = 'gpt-6-luna';
export const MODEL_CONTEXT_LIMITS = Object.freeze({
  [DEFAULT_MODEL]: Object.freeze({ contextWindow: 872000, autoCompactTokenLimit: 828400 }),
  [LIGHTWEIGHT_MODEL]: Object.freeze({ contextWindow: 872000, autoCompactTokenLimit: 828400 }),
});
export function modelContextLimits(model) {
  if (!Object.hasOwn(MODEL_CONTEXT_LIMITS, model)) {
    throw new Error(`No verified context-window limits for model ${JSON.stringify(model)}.`);
  }
  return MODEL_CONTEXT_LIMITS[model];
}
