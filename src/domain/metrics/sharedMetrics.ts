/**
 * Shared metrics tracking for both gRPC and Connect RPC servers
 * 
 * This module provides a centralized metrics tracking system that is used
 * by both protocol servers to ensure consistent metrics across all protocols.
 * 
 * Metrics tracked:
 * - Validation checks and failures
 * - Rule matches and misses
 * - Request counts by protocol
 * - Error counts by protocol
 */

/**
 * Metrics for validation operations
 */
export interface ValidationMetrics {
  /** Total number of validation checks performed */
  checks_total: number;
  /** Total number of validation failures */
  failures_total: number;
  /** Validation failures by message type */
  failures_by_type: Record<string, number>;
}

/**
 * Metrics for rule matching operations
 */
export interface RuleMatchingMetrics {
  /** Total number of rule match attempts */
  attempts_total: number;
  /** Total number of successful rule matches */
  matches_total: number;
  /** Total number of rule match misses (no rule found) */
  misses_total: number;
  /** Rule matches by rule key */
  matches_by_rule: Record<string, number>;
}

/**
 * Combined shared metrics
 */
export interface SharedMetrics {
  validation: ValidationMetrics;
  rule_matching: RuleMatchingMetrics;
}

/**
 * Shared metrics tracker
 * 
 * This class provides thread-safe metrics tracking that can be shared
 * across both gRPC and Connect RPC servers.
 */
class SharedMetricsTracker {
  private validationChecks = 0;
  private validationFailures = 0;
  private validationFailuresByType: Map<string, number> = new Map();
  
  private ruleMatchAttempts = 0;
  private ruleMatches = 0;
  private ruleMisses = 0;
  private ruleMatchesByKey: Map<string, number> = new Map();

  /**
   * Record a validation check
   * 
   * @param typeName Message type name
   * @param success Whether validation passed
   */
  recordValidationCheck(typeName: string, success: boolean): void {
    this.validationChecks++;
    
    if (!success) {
      this.validationFailures++;
      
      // Track failures by type
      const current = this.validationFailuresByType.get(typeName) || 0;
      this.validationFailuresByType.set(typeName, current + 1);
    }
  }

  /**
   * Record a rule match attempt
   * 
   * @param ruleKey Rule key that was attempted
   * @param matched Whether a rule was found
   */
  recordRuleMatchAttempt(ruleKey: string, matched: boolean): void {
    this.ruleMatchAttempts++;
    
    if (matched) {
      this.ruleMatches++;
      
      // Track matches by rule key
      const current = this.ruleMatchesByKey.get(ruleKey) || 0;
      this.ruleMatchesByKey.set(ruleKey, current + 1);
    } else {
      this.ruleMisses++;
    }
  }

  /**
   * Get current metrics snapshot
   * 
   * @returns Current metrics
   */
  getMetrics(): SharedMetrics {
    return {
      validation: {
        checks_total: this.validationChecks,
        failures_total: this.validationFailures,
        failures_by_type: Object.fromEntries(this.validationFailuresByType),
      },
      rule_matching: {
        attempts_total: this.ruleMatchAttempts,
        matches_total: this.ruleMatches,
        misses_total: this.ruleMisses,
        matches_by_rule: Object.fromEntries(this.ruleMatchesByKey),
      },
    };
  }

  /**
   * Reset all metrics to zero
   * 
   * This is useful for testing or when restarting servers.
   */
  reset(): void {
    this.validationChecks = 0;
    this.validationFailures = 0;
    this.validationFailuresByType.clear();
    
    this.ruleMatchAttempts = 0;
    this.ruleMatches = 0;
    this.ruleMisses = 0;
    this.ruleMatchesByKey.clear();
  }
}

/**
 * Global shared metrics tracker instance
 * 
 * This instance is shared across both gRPC and Connect RPC servers
 * to provide unified metrics tracking.
 */
export const sharedMetrics = new SharedMetricsTracker();
