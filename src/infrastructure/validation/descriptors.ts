import protobuf from "protobufjs";
import type { ValidationIR } from "../../domain/validation/types.js";
import { stripLeadingDot } from "../utils/protoUtils.js";

/**
 * Re-export stripLeadingDot as normalizeTypeName for backward compatibility
 * @deprecated Use stripLeadingDot from utils/protoUtils.js instead
 */
export const normalizeTypeName = stripLeadingDot;

export interface DescriptorInfo {
  root: protobuf.Root;
  messages: Map<string, protobuf.Type>;
  enums: Map<string, protobuf.Enum>;
}

export function buildDescriptorInfo(root: protobuf.Root): DescriptorInfo {
  const messages = new Map<string, protobuf.Type>();
  const enums = new Map<string, protobuf.Enum>();

  function traverse(ns: protobuf.NamespaceBase) {
    if (!ns.nested) return;

    for (const [name, nested] of Object.entries(ns.nested)) {
      if (nested instanceof protobuf.Type) {
        const fullName = nested.fullName?.replace(/^\./, "") || nested.name;
        messages.set(fullName, nested);
      } else if (nested instanceof protobuf.Enum) {
        const fullName = nested.fullName?.replace(/^\./, "") || nested.name;
        enums.set(fullName, nested);
      } else if (nested instanceof protobuf.Namespace) {
        traverse(nested);
      }
    }
  }

  traverse(root);
  return { root, messages, enums };
}

export function getMessageDescriptor(
  descriptorInfo: DescriptorInfo,
  typeName: string
): protobuf.Type | undefined {
  const normalized = stripLeadingDot(typeName);
  return descriptorInfo.messages.get(normalized);
}

export function getAllMessageTypes(descriptorInfo: DescriptorInfo): string[] {
  return Array.from(descriptorInfo.messages.keys());
}

