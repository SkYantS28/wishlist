import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'api/prisma/schema.prisma');
await mkdir(path.dirname(target), { recursive: true });
await copyFile(path.join(root, 'prisma/schema.prisma'), target);
