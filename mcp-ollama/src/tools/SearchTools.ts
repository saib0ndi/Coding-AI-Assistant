/**
 * Search tools: web_search
 */
import { ToolDependencies, MCPTool } from './ToolDependencies.js';
import { createTool, withErrorHandling } from './toolHelper.js';
import fetch from 'node-fetch';

export function createSearchTools(deps: ToolDependencies): MCPTool[] {
  return [
    createWebSearchTool(deps)
  ];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function cleanHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '') // Strip HTML tags
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Perform search via DuckDuckGo HTML scraper (zero config)
 */
async function searchDuckDuckGo(query: string, limit: number, timeoutMs: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`DuckDuckGo request failed with status ${response.status}`);
    }

    const html = await response.text();
    const results: SearchResult[] = [];
    const parts = html.split(/<div class="result results_links/);

    for (let i = 1; i < parts.length && results.length < limit; i++) {
      const part = parts[i];
      const aMatch = part.match(/class="result__a" href="([^"]+)">([\s\S]*?)<\/a>/);
      if (!aMatch) continue;

      const rawUrl = aMatch[1];
      let resultUrl = rawUrl;
      if (rawUrl.includes('uddg=')) {
        const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          resultUrl = decodeURIComponent(uddgMatch[1]);
        }
      }

      const title = cleanHtml(aMatch[2]);
      
      const snippetMatch = part.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) ||
                           part.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
      const snippet = snippetMatch ? cleanHtml(snippetMatch[1]) : '';

      results.push({ title, url: resultUrl, snippet });
    }

    return results;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Perform search via Tavily API
 */
async function searchTavily(query: string, limit: number, apiKey: string, timeoutMs: number): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        max_results: limit
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Tavily request failed with status ${response.status}`);
    }

    const data = await response.json() as { results?: Array<{ title: string; url: string; content: string }> };
    const results = data.results || [];
    return results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content
    }));
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Perform search via Brave Search API
 */
async function searchBrave(query: string, limit: number, apiKey: string, timeoutMs: number): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Brave Search request failed with status ${response.status}`);
    }

    const data = await response.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
    const results = data.web?.results || [];
    return results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description
    }));
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Perform search via Google Custom Search API
 */
async function searchGoogle(query: string, limit: number, apiKey: string, cx: string, timeoutMs: number): Promise<SearchResult[]> {
  const url = `https://customsearch.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}&num=${limit}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Google Search request failed with status ${response.status}`);
    }

    const data = await response.json() as { items?: Array<{ title: string; link: string; htmlSnippet: string }> };
    const items = data.items || [];
    return items.map(item => ({
      title: item.title,
      url: item.link,
      snippet: cleanHtml(item.htmlSnippet)
    }));
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * createWebSearchTool definitions
 */
function createWebSearchTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'web_search',
    'Search the web for up-to-date information, documentation, and answers.',
    {
      query: { type: 'string', description: 'The search query string' },
      provider: { 
        type: 'string', 
        enum: ['duckduckgo', 'tavily', 'brave', 'google'], 
        description: 'Search provider to use. If not specified, auto-selects based on environment keys, defaulting to duckduckgo.' 
      },
      limit: { type: 'number', description: 'Maximum number of results to return (default: 5, max: 10)' }
    },
    ['query'],
    async (params: any) => {
      return withErrorHandling(
        async () => {
          const query = params.query;
          if (!query || typeof query !== 'string' || query.trim() === '') {
            throw new Error('Search query must be a non-empty string');
          }

          const limit = Math.max(1, Math.min(10, Number(params.limit || 5)));
          const timeoutMs = 15000; // 15s timeout for external APIs

          // Determine provider based on input or environment keys
          let selectedProvider = params.provider;
          
          if (!selectedProvider) {
            if (process.env.TAVILY_API_KEY) {
              selectedProvider = 'tavily';
            } else if (process.env.BRAVE_API_KEY) {
              selectedProvider = 'brave';
            } else if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_CX) {
              selectedProvider = 'google';
            } else {
              selectedProvider = 'duckduckgo';
            }
          }

          deps.logger.info(`Performing web search using provider: ${selectedProvider}`);

          let results: SearchResult[] = [];
          switch (selectedProvider) {
            case 'tavily': {
              const apiKey = process.env.TAVILY_API_KEY;
              if (!apiKey) throw new Error('Tavily API key is not configured in environment (TAVILY_API_KEY)');
              results = await searchTavily(query, limit, apiKey, timeoutMs);
              break;
            }
            case 'brave': {
              const apiKey = process.env.BRAVE_API_KEY;
              if (!apiKey) throw new Error('Brave Search API key is not configured in environment (BRAVE_API_KEY)');
              results = await searchBrave(query, limit, apiKey, timeoutMs);
              break;
            }
            case 'google': {
              const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
              const cx = process.env.GOOGLE_CX;
              if (!apiKey || !cx) throw new Error('Google Search API key or CX is not configured in environment (GOOGLE_SEARCH_API_KEY, GOOGLE_CX)');
              results = await searchGoogle(query, limit, apiKey, cx, timeoutMs);
              break;
            }
            case 'duckduckgo':
            default:
              results = await searchDuckDuckGo(query, limit, timeoutMs);
              break;
          }

          return {
            query,
            provider: selectedProvider,
            count: results.length,
            results
          };
        },
        () => ({
          query: params.query || '',
          provider: params.provider || 'unknown',
          count: 0,
          results: [],
          error: 'Web search failed. Check network connection or configuration keys.'
        })
      );
    }
  );
}
