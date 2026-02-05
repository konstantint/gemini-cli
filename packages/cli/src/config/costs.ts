/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ModelCostConfig {
  inputCostPer1M: number;
  outputCostPer1M: number;
  cachedInputCostPer1M: number;
}

/**
 * Pricing in USD per 1 million tokens.
 * Source: https://ai.google.dev/gemini-api/docs/pricing
 * Values are for prompts <= 128k/200k tokens where applicable.
 */
export const GEMINI_MODEL_COSTS: Record<string, ModelCostConfig> = {
  'gemini-3-pro-preview': {
    inputCostPer1M: 2.0,
    outputCostPer1M: 12.0,
    cachedInputCostPer1M: 0.2,
  },
  'gemini-3-flash-preview': {
    inputCostPer1M: 0.5,
    outputCostPer1M: 3.0,
    cachedInputCostPer1M: 0.05,
  },
  'gemini-2.5-pro': {
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.0,
    cachedInputCostPer1M: 0.125,
  },
  'gemini-2.5-flash': {
    inputCostPer1M: 0.3,
    outputCostPer1M: 2.5,
    cachedInputCostPer1M: 0.03,
  },
  'gemini-2.5-flash-lite': {
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
    cachedInputCostPer1M: 0.01,
  },
  'gemini-2.0-flash': {
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
    cachedInputCostPer1M: 0.025,
  },
  'gemini-2.0-flash-lite': {
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.3,
    cachedInputCostPer1M: 0.01, // Estimated
  },
  'gemini-1.5-pro': {
    inputCostPer1M: 3.5,
    outputCostPer1M: 10.5,
    cachedInputCostPer1M: 0.875,
  },
  'gemini-1.5-flash': {
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.3,
    cachedInputCostPer1M: 0.01875,
  },
  'gemini-1.5-flash-8b': {
    inputCostPer1M: 0.0375,
    outputCostPer1M: 0.15,
    cachedInputCostPer1M: 0.01,
  },
  default: {
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    cachedInputCostPer1M: 0,
  },
};

export function getModelCostConfig(modelName: string): ModelCostConfig {
  const normalizedName = modelName.toLowerCase();

  // Try exact match
  if (GEMINI_MODEL_COSTS[normalizedName]) {
    return GEMINI_MODEL_COSTS[normalizedName];
  }

  // Try prefix matching or substring matching
  const knownModels = Object.keys(GEMINI_MODEL_COSTS);
  const match = knownModels.find((key) => normalizedName.includes(key));
  if (match) {
    return GEMINI_MODEL_COSTS[match];
  }

  return GEMINI_MODEL_COSTS['default'];
}

export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
): number {
  const config = getModelCostConfig(modelName);
  const uncachedInput = Math.max(0, inputTokens - cachedTokens);

  const inputCost = (uncachedInput / 1_000_000) * config.inputCostPer1M;
  const outputCost = (outputTokens / 1_000_000) * config.outputCostPer1M;
  const cachedCost = (cachedTokens / 1_000_000) * config.cachedInputCostPer1M;

  return inputCost + outputCost + cachedCost;
}
