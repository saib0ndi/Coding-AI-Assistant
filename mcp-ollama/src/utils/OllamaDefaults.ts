import {
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_MODEL,
  normalizeUrl,
  parsePositiveInteger,
} from '../config/AppConfig.js';

export { DEFAULT_OLLAMA_HOST, DEFAULT_OLLAMA_MODEL, parsePositiveInteger };

export function getOllamaHost(host = process.env.OLLAMA_HOST): string {
  return normalizeUrl(host, DEFAULT_OLLAMA_HOST);
}
