import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Try to load protobufjs; if missing (e.g. during initial docker build before npm install?), fall back to all files
let protobuf;
try {
    protobuf = require('protobufjs');
} catch (e) {
    // console.warn('[generate-descriptors] protobufjs not found, skipping validation filtering');
}

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Prefer the project root based on where this script is located
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PROTOS_DIR = path.join(PROJECT_ROOT, 'protos');
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'bin', '.descriptors.bin');

// Protoc binary is expected to be in PATH or /usr/local/bin/protoc
const PROTOC_CMD = 'protoc';

async function getLoadableProtos(allFiles) {
    if (!protobuf) return allFiles;

    const root = new protobuf.Root();
    root.resolvePath = (origin, target) => {
        if (path.isAbsolute(target) && fs.existsSync(target)) return target;
        // Simple resolution logic mirroring original script
        const fromRoot = path.resolve(PROTOS_DIR, target);
        if (fs.existsSync(fromRoot)) return fromRoot;
        if (origin) {
            const rel = path.resolve(path.dirname(origin), target);
            if (fs.existsSync(rel)) return rel;
        }
        return target;
    };

    const loaded = [];

    // Try loading all at once
    try {
        await root.load(allFiles);
        return allFiles;
    } catch (err) {
        // Fallback: load one by one
        // console.log('[generate-descriptors] Bulk load failed, filtering individually:', err.message);
        const freshRoot = new protobuf.Root();
        freshRoot.resolvePath = root.resolvePath;

        for (const f of allFiles) {
            try {
                await freshRoot.load(f);
                loaded.push(f);
            } catch (innerErr) {
                console.warn(`[generate-descriptors] Skipping incompatible proto: ${path.basename(f)} (${innerErr.message})`);
            }
        }
        return loaded;
    }
}

const isBun = typeof Bun !== 'undefined';

async function runProtoc(validFiles) {
    // Run protoc
    const args = [
        `--proto_path=${PROTOS_DIR}`,
        `--descriptor_set_out=${OUTPUT_FILE}`,
        '--include_imports',
        '--include_source_info',
        ...validFiles
    ];

    if (validFiles.length === 0) {
        fs.writeFileSync(OUTPUT_FILE, Buffer.alloc(0));
        return;
    }

    if (isBun) {
        // Bun native implementation
        try {
            const proc = Bun.spawn([PROTOC_CMD, ...args], {
                stdout: 'pipe',
                stderr: 'pipe',
            });

            const stdoutText = await new Response(proc.stdout).text();
            const stderrText = await new Response(proc.stderr).text();
            const exitCode = await proc.exited;

            if (exitCode !== 0) {
                throw new Error(stderrText || `Exit code ${exitCode}`);
            }

            if (stdoutText.trim()) console.log(stdoutText);
            if (stderrText.trim()) console.error(stderrText);
        } catch (error) {
            throw error;
        }
    } else {
        // Node.js implementation
        const { stdout, stderr } = await execFileAsync(PROTOC_CMD, args, { maxBuffer: 10 * 1024 * 1024 });
        if (stdout.trim()) console.log(stdout);
        if (stderr.trim()) console.error(stderr);
    }

    // Check output size
    if (fs.existsSync(OUTPUT_FILE)) {
        const stats = fs.statSync(OUTPUT_FILE);
        console.log(`[generate-descriptors] ✓ Generated ${OUTPUT_FILE} (${stats.size} bytes)`);
    } else {
        throw new Error('Output file not created');
    }
}

async function main() {
    console.log(`[generate-descriptors] Generating descriptor set... (Runtime: ${isBun ? 'Bun' : 'Node'})`);

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Find all .proto files in PROTOS_DIR
    const protoFiles = [];

    if (fs.existsSync(PROTOS_DIR)) {
        const entries = fs.readdirSync(PROTOS_DIR);
        for (const entry of entries) {
            if (entry.endsWith('.proto')) {
                protoFiles.push(path.join(PROTOS_DIR, entry));
            }
        }
    }

    if (protoFiles.length === 0) {
        console.log('[generate-descriptors] No proto files detected; generating empty descriptor set...');
        fs.writeFileSync(OUTPUT_FILE, Buffer.alloc(0));
        return;
    }

    const validFiles = await getLoadableProtos(protoFiles);

    console.log(`[generate-descriptors] Found ${protoFiles.length} files, ${validFiles.length} loadable by protobufjs`);

    if (validFiles.length === 0) {
        console.warn('[generate-descriptors] No valid files found after filtering. Trying all as fallback...');
    }

    try {
        await runProtoc(validFiles);
    } catch (error) {
        console.error('[generate-descriptors] Protoc failed:', error.message);
        if (error.stderr) console.error(error.stderr);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('[generate-descriptors] Unexpected error:', err);
    process.exit(1);
});
