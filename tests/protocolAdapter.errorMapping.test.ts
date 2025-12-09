/**
 * Tests for Connect RPC error mapping utilities
 * 
 * Verifies that validation errors, rule matching errors, streaming errors,
 * and generic errors are correctly mapped to Connect error format.
 */

import { describe, test, expect } from 'bun:test';
import {
  mapValidationError,
  mapNoRuleMatchError,
  mapStreamingError,
  mapGenericError,
  isValidationError,
  isRuleMatchError,
  ConnectErrorCode,
} from '../src/infrastructure/protocolAdapter.js';

describe('Error Mapping Utilities', () => {
  describe('mapValidationError', () => {
    test('should map validation result with violations array', () => {
      const validationResult = {
        ok: false,
        violations: [
          {
            field: 'name',
            description: 'must not be empty',
            rule: 'string.min_len',
          },
          {
            field: 'email',
            description: 'must be valid email',
            rule: 'string.email',
          },
        ],
      };

      const error = mapValidationError(validationResult);

      expect(error.code).toBe(ConnectErrorCode.InvalidArgument);
      expect(error.message).toContain('name: must not be empty');
      expect(error.message).toContain('email: must be valid email');
      expect(error.details).toBeDefined();
      expect(error.details?.length).toBe(2);
      expect(error.details?.[0]).toMatchObject({
        '@type': 'buf.validate.FieldViolation',
        field: 'name',
        constraint_id: 'string.min_len',
        message: 'must not be empty',
      });
    });

    test('should map direct violations array', () => {
      const violations = [
        {
          field: 'age',
          description: 'must be positive',
          rule: 'int32.gt',
          value: -5,
        },
      ];

      const error = mapValidationError(violations);

      expect(error.code).toBe(ConnectErrorCode.InvalidArgument);
      expect(error.message).toContain('age: must be positive');
      expect(error.details?.[0]).toMatchObject({
        field: 'age',
        constraint_id: 'int32.gt',
        value: -5,
      });
    });

    test('should handle gRPC error format with field_violations', () => {
      const grpcError = {
        field_violations: [
          {
            field: 'username',
            description: 'already exists',
            rule: 'unique',
          },
        ],
      };

      const error = mapValidationError(grpcError);

      expect(error.code).toBe(ConnectErrorCode.InvalidArgument);
      expect(error.message).toContain('username: already exists');
    });

    test('should handle empty violations', () => {
      const error = mapValidationError({ violations: [] });

      expect(error.code).toBe(ConnectErrorCode.InvalidArgument);
      expect(error.message).toBe('Request validation failed');
      expect(error.details).toBeUndefined();
    });

    test('should handle violations with alternative field names', () => {
      const violations = [
        {
          fieldPath: 'user.profile.bio',
          message: 'too long',
          constraintId: 'string.max_len',
        },
      ];

      const error = mapValidationError(violations);

      expect(error.message).toContain('user.profile.bio: too long');
      expect(error.details?.[0].field).toBe('user.profile.bio');
      expect(error.details?.[0].constraint_id).toBe('string.max_len');
    });
  });

  describe('mapNoRuleMatchError', () => {
    test('should map rule matching error with service and method', () => {
      const error = mapNoRuleMatchError('helloworld.Greeter', 'SayHello');

      expect(error.code).toBe(ConnectErrorCode.Unimplemented);
      expect(error.message).toContain('helloworld.Greeter/SayHello');
      expect(error.message).toContain('No rule matched');
      expect(error.details).toBeDefined();
      expect(error.details?.[0]).toMatchObject({
        '@type': 'wishmock.RuleMatchError',
        service: 'helloworld.Greeter',
        method: 'SayHello',
        rule_key: 'helloworld.greeter.sayhello',
      });
    });

    test('should include helpful message about configuring rules', () => {
      const error = mapNoRuleMatchError('test.Service', 'TestMethod');

      expect(error.message).toContain('Configure a rule file');
    });
  });

  describe('mapStreamingError', () => {
    test('should map cancellation error for server streaming', () => {
      const error = mapStreamingError({ code: 1, message: 'cancelled' }, 'server');

      expect(error.code).toBe(ConnectErrorCode.Canceled);
      expect(error.message).toContain('server streaming');
      expect(error.message).toContain('cancelled');
    });

    test('should map deadline exceeded for client streaming', () => {
      const error = mapStreamingError(
        { code: 4, message: 'deadline exceeded' },
        'client'
      );

      expect(error.code).toBe(ConnectErrorCode.DeadlineExceeded);
      expect(error.message).toContain('client streaming');
      expect(error.message).toContain('deadline exceeded');
    });

    test('should map abort error for bidi streaming', () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const error = mapStreamingError(abortError, 'bidi');

      expect(error.code).toBe(ConnectErrorCode.Canceled);
      expect(error.message).toContain('bidi streaming');
      expect(error.message).toContain('aborted');
    });

    test('should map timeout error', () => {
      const error = mapStreamingError(
        { message: 'request timeout' },
        'server'
      );

      expect(error.code).toBe(ConnectErrorCode.DeadlineExceeded);
      expect(error.message).toContain('deadline exceeded');
    });

    test('should map generic streaming error', () => {
      const error = mapStreamingError(
        { code: 13, message: 'internal error' },
        'bidi'
      );

      expect(error.code).toBe(ConnectErrorCode.Internal);
      expect(error.message).toContain('bidi streaming error');
      expect(error.message).toContain('internal error');
    });
  });

  describe('mapGenericError', () => {
    test('should map gRPC status codes to Connect codes', () => {
      const testCases = [
        { grpcCode: 1, connectCode: ConnectErrorCode.Canceled },
        { grpcCode: 3, connectCode: ConnectErrorCode.InvalidArgument },
        { grpcCode: 5, connectCode: ConnectErrorCode.NotFound },
        { grpcCode: 7, connectCode: ConnectErrorCode.PermissionDenied },
        { grpcCode: 12, connectCode: ConnectErrorCode.Unimplemented },
        { grpcCode: 13, connectCode: ConnectErrorCode.Internal },
        { grpcCode: 16, connectCode: ConnectErrorCode.Unauthenticated },
      ];

      for (const { grpcCode, connectCode } of testCases) {
        const error = mapGenericError({
          code: grpcCode,
          message: `Error with code ${grpcCode}`,
        });

        expect(error.code).toBe(connectCode);
        expect(error.message).toContain(`Error with code ${grpcCode}`);
      }
    });

    test('should handle error with validation details in message', () => {
      const grpcError = {
        code: 3,
        message: JSON.stringify({
          reason: 'validation_failed',
          field_violations: [
            { field: 'test', description: 'invalid' },
          ],
        }),
      };

      const error = mapGenericError(grpcError);

      expect(error.code).toBe(ConnectErrorCode.InvalidArgument);
      expect(error.details).toBeDefined();
      expect(error.details?.[0]).toMatchObject({
        field: 'test',
        description: 'invalid',
      });
    });

    test('should handle Connect error code strings', () => {
      const error = mapGenericError({
        code: 'invalid_argument',
        message: 'Bad request',
      });

      expect(error.code).toBe(ConnectErrorCode.InvalidArgument);
      expect(error.message).toBe('Bad request');
    });

    test('should handle standard Error objects', () => {
      const stdError = new Error('Something went wrong');

      const error = mapGenericError(stdError);

      expect(error.code).toBe(ConnectErrorCode.Internal);
      expect(error.message).toBe('Something went wrong');
      expect(error.details).toBeDefined();
      expect(error.details?.[0]).toHaveProperty('stack');
    });

    test('should handle string errors', () => {
      const error = mapGenericError('Simple error message');

      expect(error.code).toBe(ConnectErrorCode.Unknown);
      expect(error.message).toBe('Simple error message');
    });

    test('should handle null/undefined errors', () => {
      const nullError = mapGenericError(null);
      const undefinedError = mapGenericError(undefined);

      expect(nullError.code).toBe(ConnectErrorCode.Unknown);
      expect(nullError.message).toContain('unknown error');
      expect(undefinedError.code).toBe(ConnectErrorCode.Unknown);
    });

    test('should handle unknown error types', () => {
      const error = mapGenericError({ weird: 'object' });

      expect(error.code).toBe(ConnectErrorCode.Internal);
      // Should stringify the object for debugging
      expect(error.message).toContain('weird');
      expect(error.message).toContain('object');
    });

    test('should map unknown gRPC codes to Unknown', () => {
      const error = mapGenericError({ code: 999, message: 'Unknown code' });

      expect(error.code).toBe(ConnectErrorCode.Unknown);
      expect(error.message).toBe('Unknown code');
    });
  });

  describe('isValidationError', () => {
    test('should detect gRPC INVALID_ARGUMENT status', () => {
      expect(isValidationError({ code: 3 })).toBe(true);
    });

    test('should detect Connect InvalidArgument code', () => {
      expect(isValidationError({ code: ConnectErrorCode.InvalidArgument })).toBe(true);
    });

    test('should detect violations property', () => {
      expect(isValidationError({ violations: [] })).toBe(true);
      expect(isValidationError({ field_violations: [] })).toBe(true);
    });

    test('should detect validation keywords in message', () => {
      expect(isValidationError({ message: 'Validation failed' })).toBe(true);
      expect(isValidationError({ message: 'Constraint violation' })).toBe(true);
      expect(isValidationError({ message: 'Invalid input' })).toBe(true);
    });

    test('should return false for non-validation errors', () => {
      expect(isValidationError(null)).toBe(false);
      expect(isValidationError(undefined)).toBe(false);
      expect(isValidationError({ code: 5 })).toBe(false);
      expect(isValidationError({ message: 'Not found' })).toBe(false);
    });
  });

  describe('isRuleMatchError', () => {
    test('should detect gRPC UNIMPLEMENTED status', () => {
      expect(isRuleMatchError({ code: 12 })).toBe(true);
    });

    test('should detect Connect Unimplemented code', () => {
      expect(isRuleMatchError({ code: ConnectErrorCode.Unimplemented })).toBe(true);
    });

    test('should detect rule matching keywords in message', () => {
      expect(isRuleMatchError({ message: 'No rule matched' })).toBe(true);
      expect(isRuleMatchError({ message: 'Rule matched for service' })).toBe(true);
    });

    test('should return false for non-rule-match errors', () => {
      expect(isRuleMatchError(null)).toBe(false);
      expect(isRuleMatchError(undefined)).toBe(false);
      expect(isRuleMatchError({ code: 3 })).toBe(false);
      expect(isRuleMatchError({ message: 'Validation failed' })).toBe(false);
    });
  });
});
