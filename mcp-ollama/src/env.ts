import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Loads .env BEFORE any other module is initialized.
//
// ES module `import` statements are hoisted and evaluated before any inline
// statements in the importing file. Several modules construct config-dependent
// singletons at import time (e.g. intentRouter creates a VectorStore which
// builds the shared EmbeddingService). If dotenv.config() ran inline in
// index.ts, those singletons would initialize with default env (wrong Ollama
// hosts). Importing this module first guarantees .env is loaded up front.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), override: false });
