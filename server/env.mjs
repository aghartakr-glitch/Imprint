// server/env.mjs
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const OUTPUTS_DIR = join(ROOT, 'Imprint-Data')
