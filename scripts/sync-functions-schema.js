import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'api/prisma/schema.prisma');
const source = path.join(root, 'prisma/schema.prisma');
await mkdir(path.dirname(target), { recursive: true });

const schema = await readFile(source, 'utf8');
const generator = /generator client \{\r?\n\s*provider = "prisma-client-js"\r?\n\}/;
if (!generator.test(schema)) throw new Error('Could not find the Prisma client generator in the root schema.');

await writeFile(target, schema.replace(generator, `generator client {
  provider = "prisma-client-js"
  output   = "../generated/prisma"
}`));
