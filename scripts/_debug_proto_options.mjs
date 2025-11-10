import path from 'path';
import protobuf from 'protobufjs';

const PROTO_DIR = path.resolve('protos');
const targetType = process.argv[2] || 'helloworld.BufMessageCel';

async function main() {
  const root = new protobuf.Root();
  // Allow resolving from protos/ root
  const exists = (p) => { try { return !!require('fs').statSync(p); } catch { return false; } };
  root.resolvePath = (origin, target) => {
    if (path.isAbsolute(target) && exists(target)) return target;
    if (origin) {
      const rel = path.resolve(path.dirname(origin), target);
      if (exists(rel)) return rel;
    }
    const fromRoot = path.resolve(PROTO_DIR, target);
    if (exists(fromRoot)) return fromRoot;
    return path.resolve(path.dirname(origin || PROTO_DIR), target);
  };
  const files = ['helloworld.proto'];
  const namespace = await root.load(files.map((f) => path.join(PROTO_DIR, f)));
  const t = namespace.lookupType(targetType);
  console.log('Type:', t.fullName);
  console.log('Options:', t.options);
}

main().catch((e) => { console.error(e); process.exit(1); });
