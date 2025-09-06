import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";

/* ------------------------- Types ------------------------- */
export interface TeamError {
  id: string;
  errorMessage: string;
  language: string;
  solution: string;
  confidence: number;
  author: string;
  timestamp: string;
  votes: number;
}

export interface TeamTemplate {
  id: string;
  name: string;
  language: string;
  template: string;
  description: string;
  author: string;
}

export interface TeamErrorDatabase {
  errors: TeamError[];
  templates: TeamTemplate[];
}

export type Vote = 1 | -1;

/* ---------------------- Small utilities ---------------------- */
function scrub(v: unknown) {
  const CONTROL = /[\r\n\x00-\x1F\x7F-\x9F]/g;
  return String(v ?? "").replace(CONTROL, " ").replace(/\s{2,}/g, " ").trim();
}
function clamp(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
function sanitize(s: unknown, max: number) {
  return clamp(scrub(s), max);
}
// Allows alphanumeric, dots, plus, hyphen; max 64 chars for security
const SAFE_TOKEN = /^[\w.+-]{1,64}$/i;

function safeTokenOrFallback(val: unknown, fallback = "unknown"): string {
  const s = scrub(val);
  return SAFE_TOKEN.test(s) ? s : fallback;
}

function safeLog(prefix: string, e: unknown) {
  const msg = e instanceof Error ? `${e.name}: ${scrub(e.message)}` : scrub(e);
  // single-line, no control chars
  console.warn(`[TeamManager] ${prefix} ${msg}`);
}

/* ---------------------- TeamManager ---------------------- */
export class TeamManager {
  private readonly dbPath: string;
  private database: TeamErrorDatabase;
  // debounce & serialize writes
  private saveTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(dbPath: string = "./team-database.json") {
    // normalize and ensure we only ever write within the working folder
    const abs = path.resolve(dbPath);
    const dir = path.dirname(abs);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      safeLog("mkdir failed:", e);
    }
    this.dbPath = abs;
    this.database = this.loadDatabaseSync(); // one-time sync at startup is fine
  }

  /* ---------- I/O: atomic async writes, single sync read on boot ---------- */
  private loadDatabaseSync(): TeamErrorDatabase {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = fs.readFileSync(this.dbPath, "utf-8"); // constructor-only
        const parsed = JSON.parse(data);
        if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray(parsed.errors) &&
          Array.isArray(parsed.templates)
        ) {
          // Validate array elements before casting
          const validErrors = parsed.errors.filter(this.isValidTeamError);
          const validTemplates = parsed.templates.filter(this.isValidTeamTemplate);
          return {
            errors: validErrors as TeamError[],
            templates: validTemplates as TeamTemplate[],
          };
        }
        throw new Error("Invalid database format");
      }
    } catch (e) {
      safeLog("load failed:", e);
    }
    return { errors: [], templates: [] };
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // coalesce bursts of writes
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writing = this.writing.then(() => this.saveDatabaseAtomic()).catch((e) => {
        safeLog("save chain failed:", e);
      });
    }, 50);
  }

  private async saveDatabaseAtomic(): Promise<void> {
    try {
      const json = JSON.stringify(this.database, null, 2);
      const tmp = `${this.dbPath}.tmp`;
      await fsp.writeFile(tmp, json, "utf8");
      await fsp.rename(tmp, this.dbPath); // atomic on POSIX
    } catch (e) {
      safeLog("save failed:", e);
    }
  }

  /* -------------------------- Public API -------------------------- */

  addErrorSolution(errorMessage: string, language: string, solution: string, author: string): string {
    const id = this.generateId();
    const record: TeamError = {
      id,
      errorMessage: sanitize(errorMessage, 1000),
      language: safeTokenOrFallback(language),
      solution: sanitize(solution, 5000),
      confidence: 0.8,
      author: sanitize(author, 50).replace(/[^a-zA-Z0-9_-]/g, ""),
      timestamp: new Date().toISOString(),
      votes: 0,
    };
    this.database.errors.push(record);
    this.scheduleSave();
    return id;
  }

  findSimilarErrors(errorMessage: string, language: string): TeamError[] {
    const msg = scrub(errorMessage);
    const lang = safeTokenOrFallback(language);
    return this.database.errors
      .filter((e) => e.language === lang && this.calculateSimilarity(e.errorMessage, msg) > 0.7)
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 5);
  }

  voteForSolution(errorId: string, vote: Vote): boolean {
    const idx = this.database.errors.findIndex((e) => e.id === errorId);
    if (idx === -1) return false;
    this.database.errors[idx].votes += vote;
    this.scheduleSave();
    return true;
  }

  addTemplate(
    name: string,
    language: string,
    template: string,
    description: string,
    author: string
  ): string {
    const id = this.generateId();
    const tpl: TeamTemplate = {
      id,
      name: sanitize(name, 120),
      language: safeTokenOrFallback(language),
      template: sanitize(template, 8000),
      description: sanitize(description, 500),
      author: sanitize(author, 50).replace(/[^a-zA-Z0-9_-]/g, ""),
    };
    this.database.templates.push(tpl);
    this.scheduleSave();
    return id;
  }

  getTemplates(language?: string): TeamTemplate[] {
    if (!language) return this.database.templates.slice();
    const lang = safeTokenOrFallback(language);
    return this.database.templates.filter((t) => t.language === lang);
  }

  getStats(): {
    totalErrors: number;
    totalTemplates: number;
    topContributors: Array<{ author: string; contributions: number }>;
    languageStats: Array<{ language: string; count: number }>;
  } {
    return {
      totalErrors: this.database.errors.length,
      totalTemplates: this.database.templates.length,
      topContributors: this.getTopContributors(),
      languageStats: this.getLanguageStats(),
    };
  }

  /* ------------------------- Private helpers ------------------------- */

  private isValidTeamError(obj: any): obj is TeamError {
    return obj &&
      typeof obj === 'object' &&
      typeof obj.id === 'string' &&
      typeof obj.errorMessage === 'string' &&
      typeof obj.language === 'string' &&
      typeof obj.solution === 'string' &&
      typeof obj.confidence === 'number' &&
      typeof obj.author === 'string' &&
      typeof obj.timestamp === 'string' &&
      typeof obj.votes === 'number';
  }

  private isValidTeamTemplate(obj: any): obj is TeamTemplate {
    return obj &&
      typeof obj === 'object' &&
      typeof obj.id === 'string' &&
      typeof obj.name === 'string' &&
      typeof obj.language === 'string' &&
      typeof obj.template === 'string' &&
      typeof obj.description === 'string' &&
      typeof obj.author === 'string';
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const w1 = scrub(str1).toLowerCase().split(/\s+/).filter(Boolean);
    const w2 = scrub(str2).toLowerCase().split(/\s+/).filter(Boolean);
    if (w1.length === 0 || w2.length === 0) return 0;
    const s2 = new Set(w2);
    const inter = w1.filter((w) => s2.has(w)).length;
    return inter / Math.max(w1.length, w2.length);
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  private getTopContributors(): Array<{ author: string; contributions: number }> {
    const map = new Map<string, number>();
    for (const e of this.database.errors) {
      const a = e.author || "unknown";
      map.set(a, (map.get(a) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([author, contributions]) => ({ author, contributions }))
      .sort((a, b) => b.contributions - a.contributions)
      .slice(0, 10);
  }

  private getLanguageStats(): Array<{ language: string; count: number }> {
    const map = new Map<string, number>();
    for (const e of this.database.errors) {
      const lang = e.language || "unknown";
      map.set(lang, (map.get(lang) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count);
  }
}
