/**
 * Protobuf utility functions
 * 
 * Shared utilities for working with protobuf definitions across the codebase.
 */

/**
 * Normalize a protobuf type name to fully qualified name
 * 
 * Handles type names that may or may not be fully qualified:
 * - Removes leading dot if present (e.g., ".helloworld.HelloRequest" -> "helloworld.HelloRequest")
 * - If name already contains a dot, returns as-is (already qualified)
 * - Otherwise, prepends the package prefix (e.g., "HelloRequest" + "helloworld" -> "helloworld.HelloRequest")
 * 
 * @param name Type name (may be relative or fully qualified)
 * @param pkgPrefix Package prefix to use if name is not qualified
 * @returns Fully qualified type name
 */
export function normalizeTypeName(name: string, pkgPrefix: string): string {
  // Remove leading dot if present
  const n = name.startsWith(".") ? name.slice(1) : name;
  
  // If name already contains a dot, it's already qualified
  if (n.includes(".")) {
    return n;
  }
  
  // Otherwise, prepend package prefix
  return pkgPrefix ? `${pkgPrefix}.${n}` : n;
}

/**
 * Simple version of normalizeTypeName that only removes leading dot
 * 
 * Used when we don't need to add a package prefix.
 * 
 * @param typeName Type name (may have leading dot)
 * @returns Type name without leading dot
 */
export function stripLeadingDot(typeName: string): string {
  return typeName.startsWith(".") ? typeName.slice(1) : typeName;
}
