import * as vscode from 'vscode';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export interface ChatSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ChatMessage[];
}

export interface ChatSessionSummary {
    id: string;
    title: string;
    updatedAt: number;
    messageCount: number;
}

const SESSIONS_KEY = 'chatSessions';
const ACTIVE_KEY = 'activeChatSessionId';
const LEGACY_KEY = 'chatHistory';

// Assistant fallbacks that must never re-enter the context window or be shown
// as if they were real answers.
const STALE_PATTERNS = [
    'I am a coding assistant designed to help',
    'MCP server is not reachable',
    'Start the server first',
    'Error in contextual chat',
];

/**
 * Session-aware chat history persisted per-workspace.
 *
 * Each conversation is a {@link ChatSession} with its own message list. The
 * "active" session is the one the chat panel currently reads from / writes to,
 * while {@link listSessions} exposes the rest so the user can reopen and
 * continue an older chat. Storage lives in `workspaceState`, so each project
 * keeps its own independent history.
 *
 * The legacy single global buffer (`globalState['chatHistory']`) is migrated
 * once into a session on first load so existing users keep their conversation.
 */
export class ChatHistory {
    private sessions: ChatSession[] = [];
    private activeId = '';
    private context: vscode.ExtensionContext;
    private maxMessages: number;
    private maxSessions: number;

    constructor(context: vscode.ExtensionContext, maxMessages = 100, maxSessions = 50) {
        this.context = context;
        this.maxMessages = maxMessages;
        this.maxSessions = maxSessions;
        this.load();
    }

    private get store(): vscode.Memento {
        return this.context.workspaceState;
    }

    private genId(prefix: string): string {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }

    private load(): void {
        try {
            const saved = this.store.get<ChatSession[]>(SESSIONS_KEY, []);
            this.sessions = (Array.isArray(saved) ? saved : [])
                .map((s) => this.cleanSession(s))
                .filter((s): s is ChatSession => s !== null);

            // One-time migration from the legacy flat global buffer.
            if (this.sessions.length === 0) {
                const migrated = this.migrateLegacy();
                if (migrated) {
                    this.sessions.push(migrated);
                }
            }

            this.activeId = this.store.get<string>(ACTIVE_KEY, '') || '';
            if (!this.sessions.some((s) => s.id === this.activeId)) {
                this.activeId = this.sessions[0]?.id ?? '';
            }
            if (!this.activeId) {
                const session = this.createSession();
                this.sessions.unshift(session);
                this.activeId = session.id;
            }
            this.persist();
        } catch (error) {
            console.error('Failed to load chat sessions:', error);
            const session = this.createSession();
            this.sessions = [session];
            this.activeId = session.id;
        }
    }

    private cleanSession(session: ChatSession): ChatSession | null {
        if (!session || typeof session.id !== 'string' || !Array.isArray(session.messages)) {
            return null;
        }
        const messages = session.messages
            .filter((m) => !(m.role === 'assistant' && STALE_PATTERNS.some((p) => (m.content || '').includes(p))))
            .slice(-this.maxMessages);
        return {
            id: session.id,
            title: session.title || 'New chat',
            createdAt: session.createdAt || Date.now(),
            updatedAt: session.updatedAt || Date.now(),
            messages,
        };
    }

    private migrateLegacy(): ChatSession | null {
        try {
            const legacy = this.context.globalState.get<ChatMessage[]>(LEGACY_KEY, []);
            if (!Array.isArray(legacy) || legacy.length === 0) {
                return null;
            }
            const clean = legacy
                .filter((m) => !(m.role === 'assistant' && STALE_PATTERNS.some((p) => (m.content || '').includes(p))))
                .slice(-this.maxMessages);
            if (clean.length === 0) {
                return null;
            }
            const session = this.createSession();
            session.messages = clean;
            session.title = this.deriveTitle(clean);
            session.updatedAt = clean[clean.length - 1]?.timestamp ?? Date.now();
            return session;
        } catch {
            return null;
        }
    }

    private createSession(title = 'New chat'): ChatSession {
        const now = Date.now();
        return { id: this.genId('chat'), title, createdAt: now, updatedAt: now, messages: [] };
    }

    private deriveTitle(messages: ChatMessage[]): string {
        const firstUser = messages.find((m) => m.role === 'user');
        const base = (firstUser?.content || '').replace(/\s+/g, ' ').trim();
        if (!base) return 'New chat';
        return base.length > 48 ? `${base.slice(0, 47)}…` : base;
    }

    private active(): ChatSession {
        let session = this.sessions.find((s) => s.id === this.activeId);
        if (!session) {
            session = this.createSession();
            this.sessions.unshift(session);
            this.activeId = session.id;
        }
        return session;
    }

    private persist(): void {
        try {
            this.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
            if (this.sessions.length > this.maxSessions) {
                this.sessions = this.sessions.slice(0, this.maxSessions);
            }
            this.store.update(SESSIONS_KEY, this.sessions);
            this.store.update(ACTIVE_KEY, this.activeId);
        } catch (error) {
            console.error('Failed to save chat sessions:', error);
        }
    }

    // ── Message API (operates on the active session) ───────────────────────

    addMessage(role: 'user' | 'assistant', content: string): string {
        const id = this.genId('msg');
        const session = this.active();
        session.messages.push({ id, role, content, timestamp: Date.now() });
        if (session.messages.length > this.maxMessages) {
            session.messages = session.messages.slice(-this.maxMessages);
        }
        session.updatedAt = Date.now();
        if (role === 'user' && (!session.title || session.title === 'New chat')) {
            session.title = this.deriveTitle(session.messages);
        }
        this.persist();
        return id;
    }

    getMessages(): ChatMessage[] {
        return [...this.active().messages];
    }

    getRecentMessages(count: number): ChatMessage[] {
        return this.active().messages.slice(-count);
    }

    /** Clears the active conversation in place (keeps the session slot). */
    clearHistory(): void {
        const session = this.active();
        session.messages = [];
        session.title = 'New chat';
        session.updatedAt = Date.now();
        this.persist();
    }

    // ── Session API ─────────────────────────────────────────────────────────

    getActiveSessionId(): string {
        return this.activeId;
    }

    listSessions(): ChatSessionSummary[] {
        return [...this.sessions]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((s) => ({
                id: s.id,
                title: s.title || 'New chat',
                updatedAt: s.updatedAt,
                messageCount: s.messages.length,
            }));
    }

    /**
     * Starts a fresh conversation and makes it active. If the current session
     * is already empty it is reused, to avoid accumulating blank chats.
     */
    newSession(): string {
        const current = this.sessions.find((s) => s.id === this.activeId);
        if (current && current.messages.length === 0) {
            current.title = 'New chat';
            current.updatedAt = Date.now();
            this.persist();
            return current.id;
        }
        const session = this.createSession();
        this.sessions.unshift(session);
        this.activeId = session.id;
        this.persist();
        return session.id;
    }

    switchSession(id: string): boolean {
        if (!this.sessions.some((s) => s.id === id)) {
            return false;
        }
        this.activeId = id;
        this.persist();
        return true;
    }

    renameSession(id: string, title: string): void {
        const session = this.sessions.find((s) => s.id === id);
        if (session) {
            const trimmed = (title || '').trim().slice(0, 80);
            session.title = trimmed || session.title;
            this.persist();
        }
    }

    deleteSession(id: string): void {
        this.sessions = this.sessions.filter((s) => s.id !== id);
        if (this.activeId === id) {
            if (this.sessions.length === 0) {
                const session = this.createSession();
                this.sessions.push(session);
                this.activeId = session.id;
            } else {
                this.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
                this.activeId = this.sessions[0].id;
            }
        }
        this.persist();
    }

    exportHistory(): string {
        return JSON.stringify(this.active().messages, null, 2);
    }

    importHistory(data: string): boolean {
        try {
            const imported = JSON.parse(data) as ChatMessage[];
            if (Array.isArray(imported)) {
                const session = this.active();
                session.messages = imported.slice(-this.maxMessages);
                session.updatedAt = Date.now();
                if (!session.title || session.title === 'New chat') {
                    session.title = this.deriveTitle(session.messages);
                }
                this.persist();
                return true;
            }
        } catch (error) {
            console.error('Failed to import chat history:', error);
        }
        return false;
    }
}
