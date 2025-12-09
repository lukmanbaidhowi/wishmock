import { describe, it, expect, beforeEach } from "bun:test";
import { sharedMetrics } from "../src/domain/metrics/sharedMetrics.js";

describe("SharedMetrics", () => {
  beforeEach(() => {
    // Reset metrics before each test
    sharedMetrics.reset();
  });

  describe("validation metrics", () => {
    it("should track validation checks", () => {
      // Record some validation checks
      sharedMetrics.recordValidationCheck("TestMessage", true);
      sharedMetrics.recordValidationCheck("TestMessage", true);
      sharedMetrics.recordValidationCheck("TestMessage", false);

      // Get metrics
      const metrics = sharedMetrics.getMetrics();

      // Verify counts
      expect(metrics.validation.checks_total).toBe(3);
      expect(metrics.validation.failures_total).toBe(1);
    });

    it("should track validation failures by type", () => {
      // Record validation failures for different types
      sharedMetrics.recordValidationCheck("MessageA", false);
      sharedMetrics.recordValidationCheck("MessageA", false);
      sharedMetrics.recordValidationCheck("MessageB", false);
      sharedMetrics.recordValidationCheck("MessageC", true);

      // Get metrics
      const metrics = sharedMetrics.getMetrics();

      // Verify failures by type
      expect(metrics.validation.failures_by_type["MessageA"]).toBe(2);
      expect(metrics.validation.failures_by_type["MessageB"]).toBe(1);
      expect(metrics.validation.failures_by_type["MessageC"]).toBeUndefined();
    });

    it("should not track successful validations in failures_by_type", () => {
      // Record successful validations
      sharedMetrics.recordValidationCheck("TestMessage", true);
      sharedMetrics.recordValidationCheck("TestMessage", true);

      // Get metrics
      const metrics = sharedMetrics.getMetrics();

      // Verify no failures tracked
      expect(metrics.validation.failures_total).toBe(0);
      expect(Object.keys(metrics.validation.failures_by_type)).toHaveLength(0);
    });
  });

  describe("rule matching metrics", () => {
    it("should track rule match attempts", () => {
      // Record some rule match attempts
      sharedMetrics.recordRuleMatchAttempt("service.method1", true);
      sharedMetrics.recordRuleMatchAttempt("service.method2", true);
      sharedMetrics.recordRuleMatchAttempt("service.method3", false);

      // Get metrics
      const metrics = sharedMetrics.getMetrics();

      // Verify counts
      expect(metrics.rule_matching.attempts_total).toBe(3);
      expect(metrics.rule_matching.matches_total).toBe(2);
      expect(metrics.rule_matching.misses_total).toBe(1);
    });

    it("should track rule matches by key", () => {
      // Record rule matches for different keys
      sharedMetrics.recordRuleMatchAttempt("service.method1", true);
      sharedMetrics.recordRuleMatchAttempt("service.method1", true);
      sharedMetrics.recordRuleMatchAttempt("service.method2", true);
      sharedMetrics.recordRuleMatchAttempt("service.method3", false);

      // Get metrics
      const metrics = sharedMetrics.getMetrics();

      // Verify matches by rule key
      expect(metrics.rule_matching.matches_by_rule["service.method1"]).toBe(2);
      expect(metrics.rule_matching.matches_by_rule["service.method2"]).toBe(1);
      expect(metrics.rule_matching.matches_by_rule["service.method3"]).toBeUndefined();
    });

    it("should not track misses in matches_by_rule", () => {
      // Record only misses
      sharedMetrics.recordRuleMatchAttempt("service.method1", false);
      sharedMetrics.recordRuleMatchAttempt("service.method2", false);

      // Get metrics
      const metrics = sharedMetrics.getMetrics();

      // Verify no matches tracked
      expect(metrics.rule_matching.matches_total).toBe(0);
      expect(Object.keys(metrics.rule_matching.matches_by_rule)).toHaveLength(0);
    });
  });

  describe("reset", () => {
    it("should reset all metrics to zero", () => {
      // Record some metrics
      sharedMetrics.recordValidationCheck("TestMessage", true);
      sharedMetrics.recordValidationCheck("TestMessage", false);
      sharedMetrics.recordRuleMatchAttempt("service.method", true);
      sharedMetrics.recordRuleMatchAttempt("service.method", false);

      // Verify metrics are non-zero
      let metrics = sharedMetrics.getMetrics();
      expect(metrics.validation.checks_total).toBeGreaterThan(0);
      expect(metrics.rule_matching.attempts_total).toBeGreaterThan(0);

      // Reset
      sharedMetrics.reset();

      // Verify all metrics are zero
      metrics = sharedMetrics.getMetrics();
      expect(metrics.validation.checks_total).toBe(0);
      expect(metrics.validation.failures_total).toBe(0);
      expect(Object.keys(metrics.validation.failures_by_type)).toHaveLength(0);
      expect(metrics.rule_matching.attempts_total).toBe(0);
      expect(metrics.rule_matching.matches_total).toBe(0);
      expect(metrics.rule_matching.misses_total).toBe(0);
      expect(Object.keys(metrics.rule_matching.matches_by_rule)).toHaveLength(0);
    });
  });

  describe("concurrent tracking", () => {
    it("should handle multiple concurrent metric updates", () => {
      // Simulate concurrent updates
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          Promise.resolve().then(() => {
            sharedMetrics.recordValidationCheck("TestMessage", i % 2 === 0);
            sharedMetrics.recordRuleMatchAttempt("service.method", i % 3 === 0);
          })
        );
      }

      // Wait for all updates
      return Promise.all(promises).then(() => {
        // Get metrics
        const metrics = sharedMetrics.getMetrics();

        // Verify counts
        expect(metrics.validation.checks_total).toBe(100);
        expect(metrics.validation.failures_total).toBe(50); // Half failed
        expect(metrics.rule_matching.attempts_total).toBe(100);
        expect(metrics.rule_matching.matches_total).toBe(34); // Every 3rd matched (0, 3, 6, ..., 99)
        expect(metrics.rule_matching.misses_total).toBe(66);
      });
    });
  });
});
