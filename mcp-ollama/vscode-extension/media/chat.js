const vscode = acquireVsCodeApi();

let selectedModel = '';
let isAgentMode = false;
let mentionQuery = '';
let mentionStart = -1;
let mentionItems = [];
let mentionActiveIndex = 0;

// Load available models
async function loadModels() {
    try {
        vscode.postMessage({ command: 'getModels' });
    } catch (error) {
        console.error('Failed to load models:', error);
    }
}

// Configure marked to use highlight.js
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return hljs.highlight(code, { language: lang }).value;
            } catch (err) {}
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true
});

// Render markdown into a content element and decorate code blocks with copy buttons.
function renderMarkdownInto(content, text) {
    content.innerHTML = marked.parse(text || '');
    content.querySelectorAll('pre').forEach((pre) => {
        if (pre.parentNode.classList.contains('code-block-wrapper')) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = () => {
            const code = pre.querySelector('code')?.textContent || '';
            navigator.clipboard.writeText(code).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
            });
        };
        wrapper.appendChild(copyBtn);
    });
}

// Build an empty message element (avatar + bubble + content + time) and append it.
// Returns the content element so callers can fill/replace it.
function createMessageEl(isUser = false, extraClass = '') {
    const messages = document.getElementById('messages');
    const welcome = messages.querySelector('.welcome');
    if (welcome) welcome.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + (isUser ? 'user' : 'assistant') + (extraClass ? ' ' + extraClass : '');

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = isUser ? '🧑' : '✦';

    const content = document.createElement('div');
    content.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = formatTime();

    bubble.appendChild(content);
    bubble.appendChild(time);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);
    messages.appendChild(messageDiv);
    messages.scrollTop = messages.scrollHeight;

    return { messageDiv, content };
}

function addMessage(text, isUser = false) {
    const { content } = createMessageEl(isUser);
    renderMarkdownInto(content, text);
    const messages = document.getElementById('messages');
    messages.scrollTop = messages.scrollHeight;
}

// Markup for the empty-state welcome screen. Kept in one place so both the
// Clear action and an empty session render identically.
const WELCOME_HTML = `
        <div class="welcome">
            <div class="welcome-icon">✦</div>
            <h2>How can I help?</h2>
            <p class="welcome-sub">Ask anything about your code, or pick a quick action below.</p>
            <div class="quick-actions">
                <button class="quick-chip" data-cmd="Explain this code">Explain code</button>
                <button class="quick-chip" data-cmd="Review this code for issues">Review code</button>
                <button class="quick-chip" data-cmd="Generate unit tests">Generate tests</button>
                <button class="quick-chip" data-cmd="Fix any bugs or issues">Fix bugs</button>
                <button class="quick-chip" data-cmd="Optimize this code">Optimize</button>
            </div>
        </div>`;

function bindQuickChips() {
    document.querySelectorAll('.quick-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const cmd = chip.getAttribute('data-cmd');
            if (cmd) {
                const input = document.getElementById('messageInput');
                input.value = cmd;
                input.focus();
            }
        });
    });
}

function renderWelcome() {
    const messages = document.getElementById('messages');
    messages.innerHTML = WELCOME_HTML;
    bindQuickChips();
}

// Replace the entire transcript with a saved session's messages.
function renderMessages(list) {
    _abortStream();
    const messages = document.getElementById('messages');
    messages.innerHTML = '';
    if (!list || list.length === 0) {
        renderWelcome();
        return;
    }
    list.forEach(m => addMessage(m.content, m.role === 'user'));
    messages.scrollTop = messages.scrollHeight;
}

function timeAgo(ts) {
    const diff = Date.now() - ts;
    const min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    const hr = Math.round(min / 60);
    if (hr < 24) return hr + 'h ago';
    const days = Math.round(hr / 24);
    if (days < 7) return days + 'd ago';
    return new Date(ts).toLocaleDateString();
}

let activeSessionId = '';

function renderSessionsList(sessions, activeId) {
    activeSessionId = activeId || activeSessionId;
    const listEl = document.getElementById('historyList');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!sessions || sessions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'history-empty';
        empty.textContent = 'No saved chats yet.';
        listEl.appendChild(empty);
        return;
    }
    sessions.forEach(s => {
        const item = document.createElement('div');
        item.className = 'history-item' + (s.id === activeSessionId ? ' active' : '');

        const main = document.createElement('button');
        main.className = 'history-item-main';
        main.onclick = () => {
            vscode.postMessage({ command: 'loadSession', sessionId: s.id });
            closeHistoryDrawer();
        };
        const title = document.createElement('div');
        title.className = 'history-item-title';
        title.textContent = s.title || 'New chat';
        const meta = document.createElement('div');
        meta.className = 'history-item-meta';
        meta.textContent = `${s.messageCount} msg · ${timeAgo(s.updatedAt)}`;
        main.appendChild(title);
        main.appendChild(meta);

        const rename = document.createElement('button');
        rename.className = 'history-item-action';
        rename.title = 'Rename';
        rename.textContent = '✎';
        rename.onclick = (e) => {
            e.stopPropagation();
            const next = prompt('Rename chat', s.title || 'New chat');
            if (next && next.trim()) {
                vscode.postMessage({ command: 'renameSession', sessionId: s.id, title: next.trim() });
            }
        };

        const del = document.createElement('button');
        del.className = 'history-item-action danger';
        del.title = 'Delete';
        del.textContent = '🗑';
        del.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'deleteSession', sessionId: s.id });
        };

        item.appendChild(main);
        item.appendChild(rename);
        item.appendChild(del);
        listEl.appendChild(item);
    });
}

function openHistoryDrawer() {
    vscode.postMessage({ command: 'getSessions' });
    document.getElementById('historyDrawer')?.classList.add('active');
}
function closeHistoryDrawer() {
    document.getElementById('historyDrawer')?.classList.remove('active');
}

function formatTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

let isBusy = false;

function showTyping() {
    hideTyping();
    const messages = document.getElementById('messages');
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.id = 'typingIndicator';
    indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    messages.appendChild(indicator);
    messages.scrollTop = messages.scrollHeight;
}

function hideTyping() {
    const existing = document.getElementById('typingIndicator');
    if (existing) existing.remove();
}

function setBusy(busy) {
    isBusy = busy;
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.disabled = busy;
        sendBtn.textContent = busy ? '…' : 'Send';
    }
    if (busy) {
        showTyping();
    } else {
        hideTyping();
    }
}

document.querySelectorAll('.quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const cmd = chip.getAttribute('data-cmd');
        const messageInput = document.getElementById('messageInput');
        if (cmd) {
            messageInput.value = cmd;
            messageInput.focus();
        }
    });
});

document.getElementById('attachInputBtn').onclick = () => {
    vscode.postMessage({ command: 'attachFiles' });
};

document.getElementById('clearBtn').onclick = () => {
    renderWelcome();
    vscode.postMessage({ command: 'clearHistory' });
    clearAttachmentChips();
    setBusy(false);
};

document.getElementById('newChatBtn').onclick = () => {
    renderWelcome();
    clearAttachmentChips();
    setBusy(false);
    vscode.postMessage({ command: 'newChat' });
    closeHistoryDrawer();
};

document.getElementById('historyBtn').onclick = () => {
    const drawer = document.getElementById('historyDrawer');
    if (drawer && drawer.classList.contains('active')) {
        closeHistoryDrawer();
    } else {
        openHistoryDrawer();
    }
};

document.getElementById('historyCloseBtn').onclick = closeHistoryDrawer;

document.getElementById('agentToggle').onclick = () => {
    isAgentMode = !isAgentMode;
    const toggle = document.getElementById('agentToggle');
    const icon = document.getElementById('agentIcon');
    const statusBar = document.getElementById('agentStatusBar');
    const inputWrapper = document.getElementById('inputWrapper');
    const messageInput = document.getElementById('messageInput');
    
    if (isAgentMode) {
        toggle.classList.add('active');
        icon.textContent = '⚡';
        statusBar.classList.add('active');
        inputWrapper.classList.add('agent-active');
        messageInput.placeholder = 'Agent mode — describe a task to plan and execute…';
    } else {
        toggle.classList.remove('active');
        icon.textContent = '⚡';
        statusBar.classList.remove('active');
        inputWrapper.classList.remove('agent-active');
        messageInput.placeholder = 'Ask me anything…';
    }
    
    messageInput.focus();
};

document.getElementById('sendBtn').onclick = () => {
    if (isBusy) return;
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (message) {
        vscode.postMessage({ 
            command: 'sendMessage', 
            text: message, 
            model: selectedModel,
            isAgentMode: isAgentMode
        });
        input.value = '';
        input.style.height = 'auto';
        setBusy(true);
    }
};

document.getElementById('modelSelect').onchange = (e) => {
    selectedModel = e.target.value;
    vscode.postMessage({ command: 'modelChanged', model: selectedModel });
};

document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        const panel = document.getElementById('mentionSuggestions');
        if (panel.classList.contains('active')) {
            e.preventDefault();
            insertMention(mentionItems[mentionActiveIndex]);
            return;
        }
        e.preventDefault();
        document.getElementById('sendBtn').click();
    }
});

document.getElementById('messageInput').addEventListener('keydown', (e) => {
    const panel = document.getElementById('mentionSuggestions');
    if (!panel.classList.contains('active')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        hideMentionSuggestions();
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionActiveIndex = Math.min(mentionItems.length - 1, mentionActiveIndex + 1);
        renderMentionSuggestions(mentionItems);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionActiveIndex = Math.max(0, mentionActiveIndex - 1);
        renderMentionSuggestions(mentionItems);
    } else if (e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionItems[mentionActiveIndex]);
    }
});

document.getElementById('messageInput').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    updateMentionSearch(e.target);
});

function updateMentionSearch(input) {
    const cursor = input.selectionStart || 0;
    const beforeCursor = input.value.slice(0, cursor);
    // Fixed: was using \\\\s (literal) instead of \s (whitespace)
    const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);

    if (!match) {
        hideMentionSuggestions();
        return;
    }

    mentionQuery = match[1] || '';
    mentionStart = cursor - mentionQuery.length - 1;
    vscode.postMessage({ command: 'searchFileMentions', query: mentionQuery });
}

function hideMentionSuggestions() {
    mentionItems = [];
    mentionActiveIndex = 0;
    document.getElementById('mentionSuggestions').classList.remove('active');
}

function renderMentionSuggestions(items) {
    const panel = document.getElementById('mentionSuggestions');
    mentionItems = items || [];

    if (mentionItems.length === 0) {
        hideMentionSuggestions();
        return;
    }

    mentionActiveIndex = Math.min(mentionActiveIndex, mentionItems.length - 1);
    panel.innerHTML = '';
    mentionItems.forEach((item, index) => {
        const button = document.createElement('button');
        button.className = 'mention-item' + (index === mentionActiveIndex ? ' active' : '');
        button.type = 'button';
        button.innerHTML = '<span class="mention-kind">' + (item.kind === 'folder' ? '📁' : '📄') + '</span><span class="mention-path"></span>';
        button.querySelector('.mention-path').textContent = item.path;
        button.onmousedown = (event) => {
            event.preventDefault();
            insertMention(item);
        };
        panel.appendChild(button);
    });
    panel.classList.add('active');
}

function insertMention(item) {
    if (!item || mentionStart < 0) return;

    const input = document.getElementById('messageInput');
    const cursor = input.selectionStart || input.value.length;
    const before = input.value.slice(0, mentionStart);
    const after = input.value.slice(cursor);
    const inserted = item.path;
    input.value = before + inserted + after;
    const nextCursor = before.length + inserted.length;
    input.focus();
    input.setSelectionRange(nextCursor, nextCursor);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    hideMentionSuggestions();
}

// Streaming state: accumulate chunks into a single in-progress message bubble
// and re-render markdown (throttled) so the user never sees raw markup.
let _streamEl = null;        // the .message-content element
let _streamText = '';        // accumulated raw text
let _streamRaf = 0;          // pending animation frame id

function _renderStreaming() {
    _streamRaf = 0;
    if (!_streamEl) return;
    renderMarkdownInto(_streamEl, _streamText);
    // Re-append the blinking cursor after the rendered content.
    const cursor = document.createElement('span');
    cursor.className = 'stream-cursor';
    _streamEl.appendChild(cursor);
    const messages = document.getElementById('messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
}

function _appendStreamChunk(token) {
    if (!_streamEl) {
        hideTyping();
        const { messageDiv, content } = createMessageEl(false, 'streaming');
        _streamEl = content;
        _streamText = '';
    }
    _streamText += token;
    // Throttle re-rendering to one paint per frame for smoothness.
    if (!_streamRaf) {
        _streamRaf = requestAnimationFrame(_renderStreaming);
    }
}

function _finalizeStream(fullText) {
    if (_streamRaf) { cancelAnimationFrame(_streamRaf); _streamRaf = 0; }
    if (_streamEl) {
        const messageDiv = _streamEl.closest('.message');
        renderMarkdownInto(_streamEl, fullText || _streamText);
        if (messageDiv) messageDiv.classList.remove('streaming');
        _streamEl = null;
        _streamText = '';
        const messages = document.getElementById('messages');
        if (messages) messages.scrollTop = messages.scrollHeight;
    } else {
        addMessage(fullText);
    }
    setBusy(false);
}

function _abortStream() {
    if (_streamRaf) { cancelAnimationFrame(_streamRaf); _streamRaf = 0; }
    if (_streamEl) {
        const messageDiv = _streamEl.closest('.message');
        if (messageDiv) messageDiv.remove();
        _streamEl = null;
        _streamText = '';
    }
}

window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'response-chunk') {
        _appendStreamChunk(message.text || '');
    } else if (message.command === 'response-done') {
        _finalizeStream(message.text || '');
    } else if (message.command === 'response') {
        // Non-streaming path or error fallback — discard any in-progress stream.
        _abortStream();
        setBusy(false);
        addMessage(message.text);
    } else if (message.command === 'userMessage') {
        addMessage(message.text, true);
    } else if (message.command === 'models') {
        const modelSelect = document.getElementById('modelSelect');
        modelSelect.innerHTML = '';

        const models = message.models || [];
        // Adopt the first available model if none is selected yet, instead of
        // assuming a specific model is installed.
        if (!selectedModel && models.length > 0) {
            selectedModel = models[0].name;
        }

        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.name;
            option.textContent = model.displayName + ' (' + model.size + ')';
            if (model.name === selectedModel) {
                option.selected = true;
            }
            modelSelect.appendChild(option);
        });
    } else if (message.command === 'fileMentionSuggestions') {
        renderMentionSuggestions(message.items || []);
    } else if (message.command === 'attachedFiles') {
        renderAttachmentChips(message.files || []);
    } else if (message.command === 'clearAttachments') {
        clearAttachmentChips();
    } else if (message.command === 'apiSettings') {
        document.getElementById('apiUrlInput').value = message.baseUrl || 'https://api.openai.com/v1';
        document.getElementById('apiKeyInput').value = message.hasKey ? '********' : '';
        document.getElementById('apiKeyInput').placeholder = 'Paste your API key here';
        document.getElementById('apiModelInput').value = message.model || 'gpt-4o';
    } else if (message.command === 'apiSettingsSaved') {
        const modelName = message.model || 'cloud model';
        const notice = document.createElement('div');
        notice.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#2ea043;color:#fff;padding:8px 14px;border-radius:6px;font-size:12px;z-index:9999;';
        notice.textContent = 'Cloud API saved — now using ' + modelName;
        document.body.appendChild(notice);
        setTimeout(() => notice.remove(), 3000);
    } else if (message.command === 'showInlineDiffs') {
        renderInlineDiffs(message.diffs || [], message.groupId || String(Date.now()));
    } else if (message.command === 'showWorkflowSteps') {
        renderWorkflowSteps(message.taskId, message.steps || []);
    } else if (message.command === 'updateWorkflowSteps') {
        updateWorkflowSteps(message.taskId, message.steps || []);
    } else if (message.command === 'sessionsList') {
        renderSessionsList(message.sessions || [], message.activeId || '');
    } else if (message.command === 'loadSession') {
        activeSessionId = message.activeId || activeSessionId;
        renderMessages(message.messages || []);
        setBusy(false);
    }
});

function stepIcon(status) {
    return status === 'completed' ? '✓' : status === 'running' ? '⟳' : status === 'failed' ? '✗' : '○';
}
function stepStatusText(step) {
    if (step.status === 'completed') return 'Done';
    if (step.status === 'running')   return step.progress ? `Running (${step.progress}%)` : 'Running...';
    if (step.status === 'failed')    return 'Failed';
    return 'Waiting to start';
}

function buildStepEl(step) {
    const div = document.createElement('div');
    div.className = 'workflow-step ' + step.status;
    div.dataset.stepId = step.id;

    const icon = document.createElement('span');
    icon.className = 'workflow-step-icon';
    icon.textContent = stepIcon(step.status);

    const body = document.createElement('div');
    body.style.flex = '1';

    const txt = document.createElement('div');
    txt.className = 'workflow-step-text';
    txt.textContent = step.action;

    const st = document.createElement('div');
    st.className = 'workflow-step-status';
    st.textContent = stepStatusText(step);

    body.appendChild(txt);
    body.appendChild(st);

    if (step.error) {
        const err = document.createElement('div');
        err.className = 'workflow-step-error';
        err.textContent = step.error;
        body.appendChild(err);
    }

    div.appendChild(icon);
    div.appendChild(body);
    return div;
}

function renderWorkflowSteps(taskId, steps) {
    const messages = document.getElementById('messages');
    const welcome = messages.querySelector('.welcome');
    if (welcome) welcome.remove();

    const wrap = document.createElement('div');
    wrap.className = 'message assistant';
    wrap.dataset.workflowTask = taskId;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const block = document.createElement('div');
    block.className = 'workflow-block';

    // Header row with progress bar
    const header = document.createElement('div');
    header.className = 'workflow-header';
    header.innerHTML = `<span>⚡ Agent Task</span>`;
    const barWrap = document.createElement('div');
    barWrap.className = 'workflow-progress-bar';
    const fill = document.createElement('div');
    fill.className = 'workflow-progress-fill';
    fill.style.width = calcProgress(steps) + '%';
    barWrap.appendChild(fill);
    header.appendChild(barWrap);
    block.appendChild(header);

    steps.forEach(s => block.appendChild(buildStepEl(s)));

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = formatTime();

    bubble.appendChild(block);
    bubble.appendChild(time);
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
}

function calcProgress(steps) {
    if (!steps.length) return 0;
    return Math.round(steps.filter(s => s.status === 'completed').length / steps.length * 100);
}

function updateWorkflowSteps(taskId, steps) {
    const wrap = document.querySelector(`[data-workflow-task="${CSS.escape(taskId)}"]`);
    if (!wrap) { renderWorkflowSteps(taskId, steps); return; }

    const block = wrap.querySelector('.workflow-block');
    if (!block) return;

    // Update progress bar
    const fill = block.querySelector('.workflow-progress-fill');
    if (fill) fill.style.width = calcProgress(steps) + '%';

    // Remove stale steps that are no longer in the updated list
    const newIds = new Set(steps.map(s => s.id));
    block.querySelectorAll('[data-step-id]').forEach(el => {
        if (!newIds.has(el.dataset.stepId)) el.remove();
    });

    // Sync each step — update existing or append new
    steps.forEach(step => {
        const existing = block.querySelector(`[data-step-id="${CSS.escape(step.id)}"]`);
        if (existing) {
            const newEl = buildStepEl(step);
            existing.replaceWith(newEl);
        } else {
            block.appendChild(buildStepEl(step));
        }
    });

    const msgs = document.getElementById('messages');
    msgs.scrollTop = msgs.scrollHeight;
}

function computeDiffLines(original, modified) {
    const oLines = original.split('\n');
    const mLines = modified.split('\n');
    const result = [];
    const oSet = new Set(oLines);
    const mSet = new Set(mLines);
    // Simple Myers-like: collect removed then added context
    let oi = 0, mi = 0;
    while (oi < oLines.length || mi < mLines.length) {
        const ol = oLines[oi], ml = mLines[mi];
        if (oi >= oLines.length) { result.push({ type: 'add', text: ml }); mi++; }
        else if (mi >= mLines.length) { result.push({ type: 'del', text: ol }); oi++; }
        else if (ol === ml) { result.push({ type: 'ctx', text: ol }); oi++; mi++; }
        else if (!mSet.has(ol)) { result.push({ type: 'del', text: ol }); oi++; }
        else if (!oSet.has(ml)) { result.push({ type: 'add', text: ml }); mi++; }
        else { result.push({ type: 'del', text: ol }); result.push({ type: 'add', text: ml }); oi++; mi++; }
    }
    return result;
}

function renderInlineDiffs(diffs, groupId) {
    const messages = document.getElementById('messages');
    const welcome = messages.querySelector('.welcome');
    if (welcome) welcome.remove();

    const wrap = document.createElement('div');
    wrap.className = 'message assistant';
    wrap.dataset.diffGroup = groupId;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const label = document.createElement('div');
    label.className = 'message-content';
    label.innerHTML = '<p>📝 <strong>Review proposed changes</strong></p>';
    bubble.appendChild(label);

    const container = document.createElement('div');
    container.className = 'inline-diffs';

    diffs.forEach((diff, idx) => {
        const card = document.createElement('div');
        card.className = 'diff-card';
        card.dataset.filePath = diff.filePath;

        // Header (click to expand)
        const header = document.createElement('div');
        header.className = 'diff-card-header';

        const badge = document.createElement('span');
        badge.className = 'diff-status-badge ' + (diff.status || 'modified');
        badge.textContent = diff.status || 'modified';

        const fp = document.createElement('span');
        fp.className = 'diff-card-filepath';
        fp.title = diff.filePath;
        fp.textContent = diff.filePath.split('/').pop();

        const summary = document.createElement('span');
        summary.className = 'diff-card-summary';
        summary.textContent = diff.changeSummary || '';

        const chevron = document.createElement('span');
        chevron.className = 'diff-chevron';
        chevron.textContent = '▶';

        header.appendChild(badge);
        header.appendChild(fp);
        if (diff.changeSummary) header.appendChild(summary);
        header.appendChild(chevron);

        // Body (diff hunk)
        const body = document.createElement('div');
        body.className = 'diff-body' + (idx === 0 ? ' open' : '');
        if (idx === 0) chevron.classList.add('open');

        const hunk = document.createElement('div');
        hunk.className = 'diff-hunk';

        const diffLines = computeDiffLines(diff.original || '', diff.modified || '');
        // Only show lines near changes (context ±3)
        const changedIdx = new Set(diffLines.map((l, i) => l.type !== 'ctx' ? i : -1).filter(i => i >= 0));
        const toShow = new Set();
        changedIdx.forEach(i => { for (let k = Math.max(0,i-3); k <= Math.min(diffLines.length-1,i+3); k++) toShow.add(k); });

        let lastShown = -1;
        diffLines.forEach((line, i) => {
            if (!toShow.has(i)) return;
            if (lastShown >= 0 && i > lastShown + 1) {
                const sep = document.createElement('span');
                sep.className = 'diff-line ctx';
                sep.textContent = '  ···';
                hunk.appendChild(sep);
            }
            const span = document.createElement('span');
            span.className = 'diff-line ' + line.type;
            span.textContent = (line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  ') + line.text;
            hunk.appendChild(span);
            lastShown = i;
        });

        if (hunk.children.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'diff-line ctx';
            empty.textContent = '  (new file)';
            hunk.appendChild(empty);
        }

        body.appendChild(hunk);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'diff-card-actions';

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'diff-btn accept';
        acceptBtn.textContent = '✓ Accept';
        acceptBtn.onclick = () => {
            vscode.postMessage({ command: 'acceptDiff', filePath: diff.filePath, groupId });
            card.classList.add('settled');
            const lbl = document.createElement('div');
            lbl.className = 'diff-settled-label';
            lbl.textContent = '✅ Accepted';
            actions.replaceWith(lbl);
        };

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'diff-btn reject';
        rejectBtn.textContent = '✗ Reject';
        rejectBtn.onclick = () => {
            vscode.postMessage({ command: 'rejectDiff', filePath: diff.filePath, groupId });
            card.classList.add('settled');
            const lbl = document.createElement('div');
            lbl.className = 'diff-settled-label';
            lbl.textContent = '↩️ Rejected';
            actions.replaceWith(lbl);
        };

        actions.appendChild(acceptBtn);
        actions.appendChild(rejectBtn);
        body.appendChild(actions);

        header.addEventListener('click', () => {
            const isOpen = body.classList.toggle('open');
            chevron.classList.toggle('open', isOpen);
        });

        card.appendChild(header);
        card.appendChild(body);
        container.appendChild(card);
    });

    bubble.appendChild(container);

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = formatTime();
    bubble.appendChild(time);

    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
}

function renderAttachmentChips(files) {
    clearAttachmentChips();
    if (!files.length) return;
    const container = document.getElementById('attachmentChips');
    if (!container) return;
    files.forEach(file => {
        const chip = document.createElement('span');
        chip.className = 'attachment-chip';
        const kb = Math.round(file.size / 1024);

        const iconEl = document.createElement('span');
        iconEl.className = 'chip-icon';
        iconEl.textContent = getFileIcon(file.language);

        const nameEl = document.createElement('span');
        nameEl.className = 'chip-name';
        nameEl.textContent = file.name; // textContent is XSS-safe

        const sizeEl = document.createElement('span');
        sizeEl.className = 'chip-size';
        sizeEl.textContent = kb + 'KB';

        chip.appendChild(iconEl);
        chip.appendChild(nameEl);
        chip.appendChild(sizeEl);
        container.appendChild(chip);
    });
    container.style.display = 'flex';
}

function clearAttachmentChips() {
    const container = document.getElementById('attachmentChips');
    if (container) { container.innerHTML = ''; container.style.display = 'none'; }
}

function getFileIcon(lang) {
    // Use Map.get() to avoid prototype-chain access via bracket notation
    const icons = new Map([
        ['typescript', '🔷'], ['javascript', '🟨'], ['python', '🐍'],
        ['java', '☕'], ['go', '🐹'], ['rust', '🦀'], ['markdown', '📄'], ['json', '📋']
    ]);
    return icons.get(String(lang)) || '📄';
}

function escapeHtml(text) {
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Modal Event Listeners
const apiModal = document.getElementById('apiModal');
const apiSettingsBtn = document.getElementById('apiSettingsBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const saveModalBtn = document.getElementById('saveModalBtn');

if (apiSettingsBtn) {
    apiSettingsBtn.onclick = () => {
        apiModal.classList.add('active');
        vscode.postMessage({ command: 'getApiSettings' });
    };
}

const hideModal = () => {
    if (apiModal) {
        apiModal.classList.remove('active');
        document.getElementById('apiKeyInput').value = '';
    }
};

if (closeModalBtn) closeModalBtn.onclick = hideModal;
if (cancelModalBtn) cancelModalBtn.onclick = hideModal;

if (saveModalBtn) {
    saveModalBtn.onclick = () => {
        const baseUrl = document.getElementById('apiUrlInput').value.trim();
        const apiKey = document.getElementById('apiKeyInput').value.trim();
        const model = document.getElementById('apiModelInput').value.trim();

        vscode.postMessage({
            command: 'saveApiSettings',
            baseUrl,
            apiKey,
            model
        });
        hideModal();
        setTimeout(() => {
            loadModels();
        }, 500);
    };
}

// Load models and settings on startup
loadModels();
try {
    vscode.postMessage({ command: 'getApiSettings' });
} catch (e) {}

// Restore the active conversation and populate the history drawer on load.
try {
    vscode.postMessage({ command: 'restoreActive' });
} catch (e) {}

