import protobuf from "protobufjs";
import { buildDescriptorInfo, type DescriptorInfo } from "./descriptors.js";
import { extractAllRules } from "../../domain/validation/ruleExtractor.js";
import { validate } from "../../domain/validation/engine.js";
import type { ValidationIR, ValidationResult, ValidationMode, ValidationSource } from "../../domain/validation/types.js";

type ValidatorFn = (msg: unknown) => ValidationResult;

class ValidationRuntime {
  private enabled: boolean = false;
  private source: ValidationSource = 'auto';
  private modeSetting: ValidationMode = 'per_message';
  private descriptorInfo: DescriptorInfo | null = null;
  private irByType = new Map<string, ValidationIR>();
  private validators = new Map<string, ValidatorFn>();

  configureFromEnv() {
    const en = String(process.env.VALIDATION_ENABLED || '').toLowerCase();
    this.enabled = en === 'true' || en === '1';
    const src = String(process.env.VALIDATION_SOURCE || 'auto').toLowerCase();
    if (src === 'pgv' || src === 'buf' || src === 'auto') this.source = src as ValidationSource;
    const mode = String(process.env.VALIDATION_MODE || 'per_message').toLowerCase();
    if (mode === 'per_message' || mode === 'aggregate') this.modeSetting = mode as ValidationMode;
  }

  loadFromRoot(root: protobuf.Root) {
    this.configureFromEnv();
    this.descriptorInfo = buildDescriptorInfo(root);
    this.irByType.clear();
    this.validators.clear();

    const messages = this.descriptorInfo.messages;
    const irMap = extractAllRules(messages);
    for (const [typeName, ir] of irMap) {
      this.irByType.set(typeName, ir);
      this.validators.set(typeName, (msg: unknown) => validate(ir, msg));
    }
  }

  isEnabled(): boolean { return this.enabled; }
  mode(): ValidationMode { return this.modeSetting; }
  getValidator(typeFullName: string): ValidatorFn | undefined {
    const t = typeFullName.startsWith('.') ? typeFullName.slice(1) : typeFullName;
    return this.validators.get(t);
  }
  getTypesWithRules(): string[] { return Array.from(this.irByType.keys()); }
}

export const runtime = new ValidationRuntime();
