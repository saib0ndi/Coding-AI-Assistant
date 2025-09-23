"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerInlineProvider = registerInlineProvider;
const vscode = __importStar(require("vscode"));
function registerInlineProvider(ctx) {
    const provider = {
        provideInlineCompletionItems(doc, pos) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a;
                const server = vscode.workspace.getConfiguration().get('codingAiAssistant.serverUrl') || 'http://127.0.0.1:8787';
                const payload = {
                    language: doc.languageId,
                    filePath: doc.uri.fsPath,
                    cursor: doc.offsetAt(pos),
                    text: doc.getText()
                };
                const res = yield fetch(`${server}/suggest`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const reader = (_a = res.body) === null || _a === void 0 ? void 0 : _a.getReader();
                if (!reader)
                    return;
                const dec = new TextDecoder();
                let acc = '';
                while (true) {
                    const { value, done } = yield reader.read();
                    if (done)
                        break;
                    const chunk = dec.decode(value, { stream: true });
                    for (const line of chunk.split('\n')) {
                        if (line.startsWith('data:')) {
                            try {
                                const j = JSON.parse(line.slice(5));
                                if (j.text)
                                    acc += j.text;
                            }
                            catch (_b) { }
                        }
                    }
                }
                if (!acc)
                    return;
                return { items: [new vscode.InlineCompletionItem(acc, new vscode.Range(pos, pos))] };
            });
        }
    };
    ctx.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: '**/*' }, provider));
}
