// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import {
    Note,
    Priority,
    Category,
    NoteStatus,
    NoteVault,
    PRIORITY_CONFIG,
    CATEGORY_CONFIG,
    STATUS_CONFIG,
    VAULT_CONFIG,
    createNote,
} from './utils';
import { NoteStorage } from './noteStorage';
import { getConfig } from './config';

function getNoteContextValue(note: Pick<Note, 'status' | 'vault'>, armed = false): string {
    const base = note.status === 'resolved' ? 'margoNoteResolved' : 'margoNote';
    const vaultSegment = note.vault === 'team' ? 'Team' : 'Local';
    return armed ? `${base}${vaultSegment}Armed` : `${base}${vaultSegment}`;
}

function getThreadLabel(note: Note): string {
    const raw = (note.title || note.text.split(/\r?\n/)[0]).replace(/^[#*\->\s]+/, '').trim();
    const preview = raw.length > 18 ? `${raw.slice(0, 18)}…` : raw;
    if (!preview) {
        return note.status === 'resolved' ? 'Note ✓' : 'Note';
    }
    return note.status === 'resolved' ? `✓ ${preview}` : preview;
}

const CATEGORY_SVG: Record<string, string> = {
    todo: 'todo.svg',
    bug: 'bug.svg',
    note: 'note.svg',
};

class MargoComment implements vscode.Comment {
    public id: string;
    public body: string | vscode.MarkdownString;
    public mode: vscode.CommentMode;
    public author: vscode.CommentAuthorInformation;
    public contextValue?: string;
    public label?: string;
    public timestamp?: Date;

    constructor(
        public note: Note,
        private extensionUri: vscode.Uri,
        public parent?: vscode.CommentThread
    ) {
        this.id = note.id;
        this.body = MargoComment.buildBody(note);
        (this.body as vscode.MarkdownString).isTrusted = true;
        this.mode = vscode.CommentMode.Preview;
        this.contextValue = getNoteContextValue(note);
        this.author = this.buildAuthor();
        this.label = `by ${note.author}`;
        this.timestamp = new Date(note.timestamp);
    }

    private buildAuthor(): vscode.CommentAuthorInformation {
        const priorityConfig = PRIORITY_CONFIG[this.note.priority];
        const categoryConfig = CATEGORY_CONFIG[this.note.category];
        const statusConfig = STATUS_CONFIG[this.note.status];
        const vaultConfig = VAULT_CONFIG[this.note.vault];
        return {
            name: `${categoryConfig.label} · ${priorityConfig.label} · ${statusConfig.label} · ${vaultConfig.label}`,
            iconPath: vscode.Uri.joinPath(this.extensionUri, 'images', CATEGORY_SVG[this.note.category]),
        };
    }

    static buildBody(note: Note): vscode.MarkdownString {
        const md = note.text
            ? new vscode.MarkdownString(`**${note.title}**\n\n${note.text}`)
            : new vscode.MarkdownString(`**${note.title}**`);
        md.isTrusted = true;
        return md;
    }

    public refresh(): void {
        this.body = MargoComment.buildBody(this.note);
        (this.body as vscode.MarkdownString).isTrusted = true;
        this.contextValue = getNoteContextValue(this.note);
        this.author = this.buildAuthor();
        this.label = `by ${this.note.author}`;
        this.timestamp = new Date(this.note.timestamp);
    }
}

export class MargoNotesProvider {
    private commentController: vscode.CommentController;
    private threads: Map<string, vscode.CommentThread[]> = new Map();
    private noteThreadMap: Map<string, vscode.CommentThread> = new Map();
    private readonly deleteArmTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private readonly pendingReloads: Set<string> = new Set();
    private storage: NoteStorage;
    private readonly extensionUri: vscode.Uri;

    constructor(storage: NoteStorage, context: vscode.ExtensionContext) {
        this.storage = storage;
        this.extensionUri = context.extensionUri;

        this.commentController = vscode.comments.createCommentController(
            'margo',
            'Margo'
        );

        this.commentController.commentingRangeProvider = {
            provideCommentingRanges: (document: vscode.TextDocument) => {
                const lineCount = document.lineCount;
                return [new vscode.Range(0, 0, lineCount - 1, 0)];
            }
        };

        this.commentController.options = {
            placeHolder: 'Type your note here (supports Markdown)...',
            prompt: 'Add Note',
        };

        this.registerCommands(context);
    }

    public updateStorage(newStorage: NoteStorage): void {
        this.storage = newStorage;
    }

    private getNoteIdForThread(thread: vscode.CommentThread): string | undefined {
        for (const [noteId, t] of this.noteThreadMap.entries()) {
            if (t === thread) {
                return noteId;
            }
        }
        return undefined;
    }

    private registerCommands(context: vscode.ExtensionContext): void {
        const commands: vscode.Disposable[] = [
            vscode.commands.registerCommand('margo.createNote', (reply: vscode.CommentReply) => {
                this.handleCreateNote(reply);
            }),

            vscode.commands.registerCommand('margo.saveNote', (comment: MargoComment) => {
                this.handleSaveNote(comment);
            }),

            vscode.commands.registerCommand('margo.cancelNote', (comment: MargoComment) => {
                if (comment.parent) {
                    comment.mode = vscode.CommentMode.Preview;
                    comment.parent.comments = comment.parent.comments.map(c => c);
                }
            }),

            vscode.commands.registerCommand('margo.armDeleteNote', (comment: MargoComment) => {
                if (!comment.parent) return;
                const noteId = comment.note.id;
                const existing = this.deleteArmTimers.get(noteId);
                if (existing) clearTimeout(existing);
                comment.contextValue = getNoteContextValue(comment.note, true);
                comment.parent.comments = [...comment.parent.comments];
                const timer = setTimeout(() => {
                    comment.contextValue = getNoteContextValue(comment.note, false);
                    if (comment.parent) comment.parent.comments = [...comment.parent.comments];
                    this.deleteArmTimers.delete(noteId);
                }, 3000);
                this.deleteArmTimers.set(noteId, timer);
            }),

            vscode.commands.registerCommand('margo.confirmDeleteNote', (comment: MargoComment) => {
                if (!comment.parent) return;
                const noteId = comment.note.id;
                const timer = this.deleteArmTimers.get(noteId);
                if (timer) { clearTimeout(timer); this.deleteArmTimers.delete(noteId); }
                this.handleDeleteNote(comment.parent, true);
            }),

            vscode.commands.registerCommand('margo.deleteNote', (arg: vscode.CommentThread | MargoComment) => {
                const thread = 'parent' in arg && arg.parent ? arg.parent : arg as vscode.CommentThread;
                this.handleDeleteNote(thread, false);
            }),

            vscode.commands.registerCommand('margo.discardNote', (reply: vscode.CommentReply) => {
                reply.thread.dispose();
            }),

            vscode.commands.registerCommand('margo.editNote', (comment: MargoComment) => {
                if (comment.parent) {
                    comment.mode = vscode.CommentMode.Editing;
                    comment.parent.comments = comment.parent.comments.map(c => c);
                }
            }),

            vscode.commands.registerCommand('margo.resolveNote', (arg: vscode.CommentThread | MargoComment) => {
                const thread = 'parent' in arg && arg.parent ? arg.parent : arg as vscode.CommentThread;
                this.handleSetStatus(thread, 'resolved');
            }),

            vscode.commands.registerCommand('margo.unresolveNote', (arg: vscode.CommentThread | MargoComment) => {
                const thread = 'parent' in arg && arg.parent ? arg.parent : arg as vscode.CommentThread;
                this.handleSetStatus(thread, 'open');
            }),

            vscode.commands.registerCommand('margo.setVaultLocal', (arg: vscode.CommentThread | MargoComment) => {
                const thread = 'parent' in arg && arg.parent ? arg.parent : arg as vscode.CommentThread;
                this.handleSetVault(thread, 'local');
            }),

            vscode.commands.registerCommand('margo.setVaultTeam', (arg: vscode.CommentThread | MargoComment) => {
                const thread = 'parent' in arg && arg.parent ? arg.parent : arg as vscode.CommentThread;
                this.handleSetVault(thread, 'team');
            }),

            vscode.commands.registerCommand('margo.setPriorityHigh', (thread: vscode.CommentThread) =>
                this.handleSetPriority(thread, 'high')),
            vscode.commands.registerCommand('margo.setPriorityMedium', (thread: vscode.CommentThread) =>
                this.handleSetPriority(thread, 'medium')),
            vscode.commands.registerCommand('margo.setPriorityLow', (thread: vscode.CommentThread) =>
                this.handleSetPriority(thread, 'low')),

            vscode.commands.registerCommand('margo.setCategoryTodo', (thread: vscode.CommentThread) =>
                this.handleSetCategory(thread, 'todo')),
            vscode.commands.registerCommand('margo.setCategoryBug', (thread: vscode.CommentThread) =>
                this.handleSetCategory(thread, 'bug')),
            vscode.commands.registerCommand('margo.setCategoryNote', (thread: vscode.CommentThread) =>
                this.handleSetCategory(thread, 'note')),

            vscode.commands.registerCommand('margo.editProperties', (comment: MargoComment) =>
                this.handleEditProperties(comment)),

            this.commentController
        ];

        context.subscriptions.push(...commands);
    }

    private reloadThread(uri: vscode.Uri, noteId: string): void {
        this.pendingReloads.add(noteId);
        const existing = this.noteThreadMap.get(noteId);
        if (existing) {
            this.noteThreadMap.delete(noteId);
            const fileThreads = this.threads.get(uri.toString());
            if (fileThreads) {
                const idx = fileThreads.indexOf(existing);
                if (idx > -1) fileThreads.splice(idx, 1);
            }
            existing.dispose();
        }

        setTimeout(() => {
            this.pendingReloads.delete(noteId);
            if (this.noteThreadMap.has(noteId)) return;
            const stored = this.storage.getNoteById(noteId);
            if (!stored) return;
            const note = stored.note;
            const newThread = this.createThreadFromNote(uri, note);
            newThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
            const fileThreads = this.threads.get(uri.toString()) ?? [];
            if (!fileThreads.includes(newThread)) {
                fileThreads.push(newThread);
                this.threads.set(uri.toString(), fileThreads);
            }
        }, 0);
    }

    private handleSetPriority(thread: vscode.CommentThread, priority: Priority): void {
        const noteId = this.getNoteIdForThread(thread);
        if (!noteId) return;
        this.storage.updateNotePriority(noteId, priority);
        this.storage.saveImmediately();
        this.reloadThread(thread.uri, noteId);
    }

    private handleSetCategory(thread: vscode.CommentThread, category: Category): void {
        const noteId = this.getNoteIdForThread(thread);
        if (!noteId) return;
        this.storage.updateNoteCategory(noteId, category);
        this.storage.saveImmediately();
        this.reloadThread(thread.uri, noteId);
    }

    private handleSetStatus(thread: vscode.CommentThread, status: NoteStatus): void {
        const noteId = this.getNoteIdForThread(thread);
        if (!noteId) return;
        this.storage.updateNoteStatus(noteId, status);
        this.storage.saveImmediately();
        this.reloadThread(thread.uri, noteId);
    }

    private handleSetVault(thread: vscode.CommentThread, vault: NoteVault): void {
        const noteId = this.getNoteIdForThread(thread);
        if (!noteId) return;
        const current = this.storage.getNoteById(noteId)?.note;
        if (!current || current.vault === vault) return;
        this.storage.updateNoteVault(noteId, vault);
        this.storage.saveImmediately();
        this.reloadThread(thread.uri, noteId);
        vscode.window.showInformationMessage(vault === 'team' ? 'Moved to Team' : 'Moved to Local');
    }

    private async handleEditProperties(comment: MargoComment): Promise<void> {
        if (!comment.parent) return;

        const thread = comment.parent;
        const noteId = comment.note.id;
        const stored = this.storage.getNoteById(noteId);
        const note = stored?.note ?? comment.note;
        const currentCategory = note.category;
        const currentPriority = note.priority;

        interface CategoryOption extends vscode.QuickPickItem { category: Category }
        const visibleCategories: Category[] = ['todo', 'bug', 'note'];
        const categoryOptions: CategoryOption[] = visibleCategories.map(cat => ({
            label: `${CATEGORY_CONFIG[cat].icon} ${CATEGORY_CONFIG[cat].label}`,
            description: currentCategory === cat ? '$(check) Current' : '',
            category: cat,
        }));

        const pickedCategory = await vscode.window.showQuickPick(categoryOptions, {
            placeHolder: `Current: ${CATEGORY_CONFIG[currentCategory].icon} ${CATEGORY_CONFIG[currentCategory].label}`,
            title: 'Step 1/2: Category',
        });
        if (!pickedCategory) return;

        interface PriorityOption extends vscode.QuickPickItem { priority: Priority }
        const priorityOptions: PriorityOption[] = (
            ['high', 'medium', 'low'] as Priority[]
        ).map(pri => ({
            label: `${PRIORITY_CONFIG[pri].icon} ${PRIORITY_CONFIG[pri].label}`,
            description: currentPriority === pri ? '$(check) Current' : '',
            priority: pri,
        }));

        const pickedPriority = await vscode.window.showQuickPick(priorityOptions, {
            placeHolder: `Current: ${PRIORITY_CONFIG[currentPriority].icon} ${PRIORITY_CONFIG[currentPriority].label}`,
            title: 'Step 2/2: Priority',
        });
        if (!pickedPriority) return;

        let needsRefresh = false;
        if (pickedCategory.category !== currentCategory) {
            this.storage.updateNoteCategory(noteId, pickedCategory.category);
            needsRefresh = true;
        }
        if (pickedPriority.priority !== currentPriority) {
            this.storage.updateNotePriority(noteId, pickedPriority.priority);
            needsRefresh = true;
        }

        if (needsRefresh) {
            this.storage.saveImmediately();
            this.reloadThread(thread.uri, noteId);
        }
    }

    private async handleCreateNote(reply: vscode.CommentReply): Promise<void> {
        const thread = reply.thread;
        const raw = reply.text;
        if (!raw.trim()) return;

        const lines = raw.split(/\r?\n/);
        const title = lines[0].trim();
        const body = lines.slice(1).join('\n').replace(/^\n+/, '').trim();

        const line = thread.range?.start.line ?? 0;
        const config = getConfig();
        const note = createNote(
            line,
            title,
            body,
            config.defaultAuthor,
            config.defaultPriority,
            config.defaultCategory,
            'local'
        );

        this.storage.addNote(thread.uri, note);

        const comment = new MargoComment(note, this.extensionUri, thread);
        thread.comments = [comment];
        thread.canReply = false;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        thread.label = getThreadLabel(note);

        this.noteThreadMap.set(note.id, thread);
        const fileThreads = this.threads.get(thread.uri.toString()) || [];
        if (!fileThreads.includes(thread)) {
            fileThreads.push(thread);
            this.threads.set(thread.uri.toString(), fileThreads);
        }
    }

    private handleSaveNote(comment: MargoComment): void {
        if (!comment.parent) return;

        const thread = comment.parent;
        const uri = thread.uri;
        const noteId = comment.note.id;
        const raw = typeof comment.body === 'string' ? comment.body : comment.body.value;
        const lines = raw.split(/\r?\n/);
        const newTitle = lines[0].replace(/^\*\*|\*\*$/g, '').trim();
        const newText = lines.slice(1).join('\n').replace(/^\n+/, '').trim();

        this.storage.updateNote(uri, noteId, newTitle, newText);
        this.storage.saveImmediately();

        // VS Code caches comment widget rendering by thread reference; in-place
        // mutation of comment.body is ignored on the first edit/save cycle of
        // a freshly-rendered thread. Dispose + deferred recreate forces a clean render.
        this.noteThreadMap.delete(noteId);
        const fileThreads = this.threads.get(uri.toString());
        if (fileThreads) {
            const idx = fileThreads.indexOf(thread);
            if (idx > -1) fileThreads.splice(idx, 1);
        }
        thread.dispose();

        setTimeout(() => {
            const note = this.storage.getNoteById(noteId)?.note;
            if (!note) return;
            const newThread = this.createThreadFromNote(uri, note);
            newThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        }, 0);
    }

    private async handleDeleteNote(thread: vscode.CommentThread, skipConfirm = false): Promise<void> {
        const config = getConfig();
        if (!skipConfirm && config.confirmDelete) {
            const answer = await vscode.window.showWarningMessage(
                'Delete this note?',
                { modal: true },
                'Delete',
                'Cancel'
            );
            if (answer !== 'Delete') return;
        }

        const noteId = this.getNoteIdForThread(thread);
        if (noteId) {
            this.storage.deleteNote(thread.uri, noteId);
            this.noteThreadMap.delete(noteId);
        }

        const fileThreads = this.threads.get(thread.uri.toString());
        if (fileThreads) {
            const index = fileThreads.indexOf(thread);
            if (index > -1) {
                fileThreads.splice(index, 1);
            }
        }

        thread.dispose();
    }

    public renderNotesForFile(uri: vscode.Uri): void {
        this.clearThreadsForFile(uri);

        const config = getConfig();
        const notes = this.storage.getNotesForFile(uri);
        if (notes.length === 0) return;

        const threads: vscode.CommentThread[] = [];
        for (const note of notes) {
            if (!config.showResolvedNotes && note.status === 'resolved') continue;
            if (this.pendingReloads.has(note.id)) continue;
            const existing = this.noteThreadMap.get(note.id);
            if (existing) {
                threads.push(existing);
            } else {
                const thread = this.createThreadFromNote(uri, note);
                threads.push(thread);
            }
        }

        this.threads.set(uri.toString(), threads);
    }

    private createThreadFromNote(uri: vscode.Uri, note: Note): vscode.CommentThread {
        const range = new vscode.Range(note.line, 0, note.line, 0);
        const thread = this.commentController.createCommentThread(uri, range, []);

        const comment = new MargoComment(note, this.extensionUri, thread);
        thread.comments = [comment];
        thread.canReply = false;
        thread.contextValue = 'margoNoteThread';
        thread.label = getThreadLabel(note);
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;

        this.noteThreadMap.set(note.id, thread);
        return thread;
    }

    public async addNoteAtLine(uri: vscode.Uri, line: number): Promise<void> {
        const range = new vscode.Range(line, 0, line, 0);
        const thread = this.commentController.createCommentThread(uri, range, []);
        thread.canReply = true;
        thread.contextValue = 'margoNoteThread';
        thread.label = 'Note';
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }

    public registerHoverProvider(context: vscode.ExtensionContext): void {
        const provider = vscode.languages.registerHoverProvider('*', {
            provideHover: (document, position) => {
                const notes = this.storage.getNotesForFile(document.uri);
                const lineNotes = notes.filter(n => n.line === position.line);
                if (lineNotes.length === 0) return undefined;

                const md = new vscode.MarkdownString('', true);
                md.isTrusted = true;
                md.supportHtml = true;

                for (const note of lineNotes) {
                    const cat = CATEGORY_CONFIG[note.category];
                    const pri = PRIORITY_CONFIG[note.priority];
                    const status = STATUS_CONFIG[note.status];
                    const vault = VAULT_CONFIG[note.vault];
                    md.appendMarkdown(`**${cat.icon} ${cat.label}** · ${pri.icon} ${pri.label} · ${status.label} · ${vault.label}\n\n`);
                    md.appendMarkdown(`${note.text}\n\n`);
                    if (lineNotes.length > 1) md.appendMarkdown('---\n\n');
                }

                return new vscode.Hover(md);
            }
        });
        context.subscriptions.push(provider);
    }

    public refreshAllThreads(): void {
        if (vscode.window.activeTextEditor) {
            this.renderNotesForFile(vscode.window.activeTextEditor.document.uri);
        }
    }

    public clearThreadsForFile(uri: vscode.Uri): void {
        const fileThreads = this.threads.get(uri.toString());
        if (fileThreads) {
            for (const thread of fileThreads) {
                const noteId = this.getNoteIdForThread(thread);
                if (noteId) {
                    this.noteThreadMap.delete(noteId);
                }
                thread.dispose();
            }
            this.threads.delete(uri.toString());
        }
    }

    public expandThreadForNote(_uri: vscode.Uri, noteId: string): void {
        const thread = this.noteThreadMap.get(noteId);
        if (thread) {
            thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        }
    }

    public clearAllThreads(): void {
        for (const threads of this.threads.values()) {
            threads.forEach(thread => thread.dispose());
        }
        this.threads.clear();
        this.noteThreadMap.clear();
    }

    public dispose(): void {
        this.clearAllThreads();
        this.commentController.dispose();
    }
}
