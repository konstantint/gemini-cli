/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { calculateCost, getModelCostConfig } from './costs.js';

describe('costs', () => {
  describe('getModelCostConfig', () => {
    it('should return exact match for known models', () => {
      const config = getModelCostConfig('gemini-2.0-flash');
      expect(config.inputCostPer1M).toBe(0.1);
    });

    it('should return substring match for versioned models', () => {
      const config = getModelCostConfig('gemini-2.0-flash-001');
      expect(config.inputCostPer1M).toBe(0.1);
    });

    it('should return default for unknown models', () => {
      const config = getModelCostConfig('unknown-model');
      expect(config.inputCostPer1M).toBe(0);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost correctly for gemini-2.0-flash', () => {
      // 1M input, 1M output, 0 cached
      const cost = calculateCost('gemini-2.0-flash', 1_000_000, 1_000_000, 0);
      expect(cost).toBe(0.1 + 0.4);
    });

    it('should calculate cost correctly with cached tokens', () => {
      // 1M prompt (500k input, 500k cached), 1M output
      // Note: calculateCost takes inputTokens (total prompt tokens) and cachedTokens.
      // inputCost is calculated on (inputTokens - cachedTokens).
      const cost = calculateCost(
        'gemini-2.0-flash',
        1_000_000,
        1_000_000,
        500_000,
      );
      // uncached input: 500k * 0.10/1M = 0.05
      // cached input: 500k * 0.025/1M = 0.0125
      // output: 1M * 0.40/1M = 0.40
      // total: 0.4625
      expect(cost).toBe(0.05 + 0.4 + 0.0125);
    });

    it('should handle zero tokens', () => {
      const cost = calculateCost('gemini-2.0-flash', 0, 0, 0);
      expect(cost).toBe(0);
    });
  });
});
