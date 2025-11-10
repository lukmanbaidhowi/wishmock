import protobuf from "protobufjs";
import { buildDescriptorInfo, type DescriptorInfo } from "./descriptors.js";
import { extractAllRules } from "../../domain/validation/ruleExtractor.js";
import { validate } from "../../domain/validation/engine.js";
import type { ValidationIR, ValidationResult, ValidationMode, ValidationSource } from "../../domain/validation/types.js";

type ValidatorFn = (msg: unknown) => ValidationResult;

export interface ValidationEvent {
  eventId: string;
  scenarioName?: string;
  typeName: string;
  result: 'success' | 'failure';
  details: {
    constraint_id?: string;
    grpc_status?: string;
    error_message?: string;
  };
  emittedAt: Date;
}

export interface ValidationMetrics {
  totalValidations: number;
  successCount: number;
  failureCount: number;
  lastValidation?: Date;
  byConstraintType: Record<string, { failure: number }>;
}

class ValidationRuntime {
  private enabled: boolean = false;
  private source: ValidationSource = 'auto';
  private modeSetting: ValidationMode = 'per_message';
  private celMessageMode: 'experimental' | 'off' = 'off';
  private descriptorInfo: DescriptorInfo | null = null;
  private irByType = new Map<string, ValidationIR>();
  private validators = new Map<string, ValidatorFn>();
  private metrics: ValidationMetrics = {
    totalValidations: 0,
    successCount: 0,
    failureCount: 0,
    byConstraintType: {}
  };
  private recentEvents: ValidationEvent[] = [];

  configureFromEnv() {
    const en = String(process.env.VALIDATION_ENABLED || '').toLowerCase();
    this.enabled = en === 'true' || en === '1';
    const src = String(process.env.VALIDATION_SOURCE || 'auto').toLowerCase();
    // Accept 'protovalidate' (preferred) and map legacy 'buf' to 'protovalidate'
    if (src === 'pgv' || src === 'protovalidate' || src === 'auto') this.source = src as ValidationSource;
    else if (src === 'buf') this.source = 'protovalidate';
    const mode = String(process.env.VALIDATION_MODE || 'per_message').toLowerCase();
    if (mode === 'per_message' || mode === 'aggregate') this.modeSetting = mode as ValidationMode;
    const celMsg = String(process.env.VALIDATION_CEL_MESSAGE || 'off').toLowerCase();
    this.celMessageMode = (celMsg === 'experimental') ? 'experimental' : 'off';
  }

  loadFromRoot(root: protobuf.Root) {
    this.configureFromEnv();
    if (process.env.DEBUG_VALIDATION === '1') {
      console.log('[validation][debug] enabled=', this.enabled, 'source=', this.source, 'mode=', this.modeSetting, 'messageCEL=', this.celMessageMode);
    }
    this.descriptorInfo = buildDescriptorInfo(root);
    this.irByType.clear();
    this.validators.clear();

    const messages = this.descriptorInfo.messages;
    const irMap = extractAllRules(messages, this.source);
    const enforceMessageCel = (this.source === 'protovalidate') || (this.celMessageMode === 'experimental');
    for (const [typeName, ir] of irMap) {
      this.irByType.set(typeName, ir);
      this.validators.set(typeName, (msg: unknown) => validate(ir, msg, { enforceMessageCel }));
    }
    
    if (this.enabled && process.env.DEBUG_VALIDATION === '1') {
      console.log('[validation] Loaded validators for types:', Array.from(this.validators.keys()).filter(t => !t.startsWith('buf.validate')));
    }
  }

  isEnabled(): boolean { return this.enabled; }
  // Active when enabled (enforce for whichever source was configured)
  active(): boolean { return this.enabled; }
  mode(): ValidationMode { return this.modeSetting; }
  getValidator(typeFullName: string): ValidatorFn | undefined {
    const t = typeFullName.startsWith('.') ? typeFullName.slice(1) : typeFullName;
    return this.validators.get(t);
  }
  getTypesWithRules(): string[] { return Array.from(this.irByType.keys()); }

  emitValidationEvent(event: Omit<ValidationEvent, 'eventId' | 'emittedAt'>) {
    const fullEvent: ValidationEvent = {
      ...event,
      eventId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      emittedAt: new Date()
    };
    
    this.metrics.totalValidations++;
    if (fullEvent.result === 'success') {
      this.metrics.successCount++;
    } else {
      this.metrics.failureCount++;
    }
    this.metrics.lastValidation = fullEvent.emittedAt;

    if (fullEvent.details.constraint_id) {
      const cid = fullEvent.details.constraint_id;
      if (!this.metrics.byConstraintType[cid]) {
        this.metrics.byConstraintType[cid] = { failure: 0 };
      }
      if (fullEvent.result === 'failure') {
        this.metrics.byConstraintType[cid].failure++;
      }
    }

    this.recentEvents.push(fullEvent);
    if (this.recentEvents.length > 100) {
      this.recentEvents.shift();
    }

    if (process.env.DEBUG_VALIDATION === '1') {
      console.log('[validation][event]', JSON.stringify(fullEvent));
    }
  }

  getMetrics(): ValidationMetrics {
    return { ...this.metrics };
  }

  getRecentEvents(limit: number = 20): ValidationEvent[] {
    return this.recentEvents.slice(-limit);
  }

  getCoverageInfo() {
    const types = this.getTypesWithRules();
    return {
      enabled: this.enabled,
      source: this.source,
      mode: this.modeSetting,
      celMessageMode: this.celMessageMode,
      loadedTypes: types.length,
      typeNames: types,
      metrics: this.getMetrics()
    };
  }
}

export const runtime = new ValidationRuntime();
