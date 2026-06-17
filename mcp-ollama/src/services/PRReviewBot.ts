/**
 * PRReviewBot — automated pull-request code review.
 *
 * Triggered by the GitHub webhook handler in HTTPServer when a
 * pull_request event with action "opened" or "synchronize" arrives.
 *
 * Workflow:
 *   1. Fetch the PR diff from GitHub.
 *   2. Send the diff + a review prompt to Ollama.
 *   3. Parse the LLM response into a structured review.
 *   4. Post the review back as a GitHub PR review comment.
 *
 * Configuration:
 *   GITHUB_WEBHOOK_SECRET — HMAC secret for verifying webhook signatures (optional but recommended).
 *   GITHUB_TOKEN          — token with "pull_requests:write" scope.
 *   MCP_OLLAMA_PR_REVIEW_MODEL — model override (defaults to the configured code model).
 *   MCP_OLLAMA_PR_REVIEW_EVENT — review event type: COMMENT (default) | REQUEST_CHANGES | APPROVE.
 */

import crypto from 'crypto';
import { GitHubService } from './GitHubService.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { Logger } from '../utils/Logger.js';

export interface PRReviewPayload {
    action: string;
    number: number;
    pull_request: {
        head: { sha: string };
        title: string;
        body?: string;
        user: { login: string };
    };
    repository: {
        name: string;
        owner: { login: string };
    };
}

export interface ReviewResult {
    summary: string;
    suggestions: string[];
    event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';
}

const MAX_DIFF_CHARS = 12_000;
const REVIEW_SYSTEM_PROMPT = `You are a senior engineer performing an automated code review.
Given a pull-request diff, produce a concise, actionable review in JSON:

{
  "summary": "<2-4 sentence overall assessment>",
  "suggestions": [
    "<specific actionable suggestion 1>",
    "<specific actionable suggestion 2>"
  ],
  "verdict": "approve" | "comment" | "request_changes"
}

Guidelines:
- Focus on correctness, security, and maintainability.
- Ignore pure style nitpicks unless they cause bugs.
- Keep suggestions brief and concrete.
- Return ONLY valid JSON, no markdown.`;

function parseReview(raw: string): ReviewResult {
    // Strip markdown fences if present
    const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    let parsed: any;
    try {
        parsed = JSON.parse(json);
    } catch {
        // Fallback: treat the raw text as a plain comment.
        return {
            summary: raw.slice(0, 2000),
            suggestions: [],
            event: 'COMMENT',
        };
    }
    const verdictMap: Record<string, 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'> = {
        approve: 'APPROVE',
        comment: 'COMMENT',
        request_changes: 'REQUEST_CHANGES',
    };
    return {
        summary: String(parsed.summary ?? ''),
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
        event: verdictMap[String(parsed.verdict ?? 'comment')] ?? 'COMMENT',
    };
}

export class PRReviewBot {
    private logger: Logger;
    private githubService: GitHubService;

    constructor(private ollamaProvider: OllamaProvider) {
        this.logger = new Logger();
        this.githubService = GitHubService.getInstance();
    }

    // ------------------------------------------------------------------
    // Webhook signature verification
    // ------------------------------------------------------------------

    static verifySignature(body: string, signatureHeader: string | undefined): boolean {
        const secret = process.env.GITHUB_WEBHOOK_SECRET;
        if (!secret) return true; // No secret configured — allow all (not recommended in prod).
        if (!signatureHeader) return false;
        const [algo, sig] = signatureHeader.split('=');
        if (algo !== 'sha256' || !sig) return false;
        const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
        return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    }

    // ------------------------------------------------------------------
    // Main entry point
    // ------------------------------------------------------------------

    async handleWebhook(payload: PRReviewPayload): Promise<void> {
        if (payload.action !== 'opened' && payload.action !== 'synchronize') {
            this.logger.info(`[PRReviewBot] Ignoring PR event action "${payload.action}"`);
            return;
        }

        const owner = payload.repository.owner.login;
        const repo = payload.repository.name;
        const prNumber = payload.number;
        const prTitle = payload.pull_request.title;

        this.logger.info(`[PRReviewBot] Reviewing PR #${prNumber} "${prTitle}" in ${owner}/${repo}`);

        let diff: string;
        try {
            diff = await this.githubService.getPullRequestDiff(owner, repo, prNumber);
        } catch (err) {
            this.logger.error(`[PRReviewBot] Failed to fetch diff: ${err}`);
            return;
        }

        if (diff.length > MAX_DIFF_CHARS) {
            diff = diff.slice(0, MAX_DIFF_CHARS) + '\n[diff truncated]';
        }

        const prompt = `${REVIEW_SYSTEM_PROMPT}

Pull Request: #${prNumber} — ${prTitle}
Author: ${payload.pull_request.user.login}
${payload.pull_request.body ? `Description:\n${payload.pull_request.body}\n` : ''}
Diff:
\`\`\`diff
${diff}
\`\`\``;

        let rawReview: string;
        try {
            const model = process.env.MCP_OLLAMA_PR_REVIEW_MODEL
                || this.ollamaProvider.getModel(undefined, 'code');
            rawReview = await this.ollamaProvider.generateText({ prompt, model });
        } catch (err) {
            this.logger.error(`[PRReviewBot] LLM review failed: ${err}`);
            return;
        }

        const review = parseReview(rawReview);

        // Determine the event type (env override > LLM verdict)
        const envEvent = process.env.MCP_OLLAMA_PR_REVIEW_EVENT as 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' | undefined;
        const event = (envEvent && ['COMMENT', 'REQUEST_CHANGES', 'APPROVE'].includes(envEvent))
            ? envEvent
            : review.event;

        const lines: string[] = [
            `**Automated Code Review** (powered by mcp-ollama)\n`,
            review.summary,
        ];
        if (review.suggestions.length > 0) {
            lines.push('\n**Suggestions:**');
            review.suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
        }
        const body = lines.join('\n');

        try {
            const posted = await this.githubService.postPullRequestReview(owner, repo, prNumber, body, event);
            this.logger.info(`[PRReviewBot] Posted review ${posted.id} → ${posted.html_url}`);
        } catch (err) {
            this.logger.error(`[PRReviewBot] Failed to post review: ${err}`);
        }
    }
}
