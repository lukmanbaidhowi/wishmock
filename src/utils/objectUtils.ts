export function getValue(obj: unknown, path: string, defaultValue?: unknown): unknown {
    if (obj == null) {
        return defaultValue;
    }

    // Handle simple property access if path has no dots/brackets
    if (!path.includes('.') && !path.includes('[')) {
        const val = (obj as any)[path];
        return val === undefined ? defaultValue : val;
    }

    // Split path into segments: "a.b[0].c" -> ["a", "b", "0", "c"]
    // This regex matches property names or array indices in brackets
    const segments = path.split(/[\.\[\]]/).filter(Boolean);

    let current: any = obj;
    for (const key of segments) {
        if (current == null) {
            return defaultValue;
        }
        current = current[key];
    }

    return current === undefined ? defaultValue : current;
}
