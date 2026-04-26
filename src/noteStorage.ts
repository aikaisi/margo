// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Note, NoteStatus, NoteVault, getRelativePath, normalizeFilePath, debounce, migrateNote, Priority, Category } from './utils';

const TEAM_FILENAME = '.notes.json';
const LOCAL_DIR = '.margo';
const LOCAL_FILENAME = 'local.notes.json';
const LOCAL_GITIGNORE = '*\n!.gitignore\n';

export type NotesData = { [relativePath: string]: Note[] };
export type NoteChangeListener = () => void;

export class NoteStorage {
    private workspaceRoot: string;
    private readonly teamFilePath: string;
    private readonly localFilePath: string;
    private notes: Map<string, Note[]> = new Map();
    private watchers: vscode.FileSystemWatcher[] = [];
    private saveDebounced: () => void;
    private reloadDebounced?: () => void;
    private changeListeners: NoteChangeListener[] = [];
    private isSelfSaving = false;
    private isSaveLocked = false;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.teamFilePath = path.join(workspaceRoot, TEAM_FILENAME);
        this.localFilePath = path.join(workspaceRoot, LOCAL_DIR, LOCAL_FILENAME);
        this.saveDebounced = debounce(() => this.saveNow(), 100);
    }

    public getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    public onDidChange(listener: NoteChangeListener): vscode.Disposable {
        this.changeListeners.push(listener);
        return new vscode.Disposable(() => {
            const index = this.changeListeners.indexOf(listener);
            if (index > -1) this.changeListeners.splice(index, 1);
        });
    }

    private notifyChange(): void {
        for (const listener of this.changeListeners) listener();
    }

    public async load(): Promise<void> {
        this.notes.clear();
        await this.loadFile(this.teamFilePath, 'team');
        await this.loadFile(this.localFilePath, 'local');
        const allNoteIds = new Set<string>();
        let hasDuplicates = false;
        for (const notes of this.notes.values()) {
            for (const note of notes) {
                if (allNoteIds.has(note.id)) {
                    hasDuplicates = true;
                    break;
                }
                allNoteIds.add(note.id);
            }
            if (hasDuplicates) break;
        }
        if (hasDuplicates) {
            await this.saveNow();
        }
        console.log(`Margo: Loaded ${this.getTotalNoteCount()} notes`);
    }

    private async loadFile(filePath: string, vault: NoteVault): Promise<void> {
        try {
            if (!fs.existsSync(filePath)) return;
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const data: NotesData = JSON.parse(content);
            for (const [filePath, notes] of Object.entries(data)) {
                const key = normalizeFilePath(filePath);
                const existing = this.notes.get(key) || [];
                const migrated = notes.map(n => migrateNote({ ...n, vault }));
                const deduped = existing.filter(n => !migrated.some(m => m.id === n.id));
                deduped.push(...migrated);
                this.notes.set(key, deduped);
            }
        } catch (error) {
            console.error(`Margo: Failed to load ${filePath}:`, error);
        }
    }

    private async ensureLocalDir(): Promise<void> {
        const dir = path.join(this.workspaceRoot, LOCAL_DIR);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(path.join(dir, '.gitignore'), LOCAL_GITIGNORE, 'utf-8');
        }
    }

    public renameFile(oldUri: vscode.Uri, newUri: vscode.Uri): void {
        const oldPath = normalizeFilePath(getRelativePath(oldUri.fsPath, this.workspaceRoot));
        const newPath = normalizeFilePath(getRelativePath(newUri.fsPath, this.workspaceRoot));
        const notes = this.notes.get(oldPath);
        if (!notes) return;
        this.notes.delete(oldPath);
        this.notes.set(newPath, notes);
        this.save();
    }

    public getTotalNoteCount(): number {
        let count = 0;
        for (const notes of this.notes.values()) count += notes.length;
        return count;
    }

    public getAllNotes(): Map<string, Note[]> {
        return new Map(this.notes);
    }

    public getFilesWithNotes(): string[] {
        return Array.from(this.notes.keys());
    }

    public getNotesForFile(fileUri: vscode.Uri): Note[] {
        const relativePath = getRelativePath(fileUri.fsPath, this.workspaceRoot);
        return this.notes.get(normalizeFilePath(relativePath)) || [];
    }

    public getNotesForFileInternal(fileUri: vscode.Uri): Note[] | undefined {
        const relativePath = getRelativePath(fileUri.fsPath, this.workspaceRoot);
        return this.notes.get(normalizeFilePath(relativePath));
    }

    public save(): void {
        this.saveDebounced();
    }

    public saveImmediately(): void {
        this.saveNow();
    }

    private async saveNow(): Promise<void> {
        while (this.isSaveLocked) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        this.isSaveLocked = true;
        try {
            const teamData: NotesData = {};
            const localData: NotesData = {};

            for (const [filePath, notes] of this.notes.entries()) {
                const teamNotes = notes.filter(n => n.vault === 'team');
                const localNotes = notes.filter(n => n.vault !== 'team');
                if (teamNotes.length > 0) teamData[filePath] = teamNotes;
                if (localNotes.length > 0) localData[filePath] = localNotes;
            }

            this.isSelfSaving = true;

            if (Object.keys(teamData).length > 0) {
                await fs.promises.writeFile(this.teamFilePath, JSON.stringify(teamData, null, 2), 'utf-8');
            } else if (fs.existsSync(this.teamFilePath)) {
                await fs.promises.unlink(this.teamFilePath);
            }

            if (Object.keys(localData).length > 0) {
                await this.ensureLocalDir();
                await fs.promises.writeFile(this.localFilePath, JSON.stringify(localData, null, 2), 'utf-8');
            } else if (fs.existsSync(this.localFilePath)) {
                await fs.promises.unlink(this.localFilePath);
            }

            setTimeout(() => { this.isSelfSaving = false; }, 200);
            this.notifyChange();
        } catch (error) {
            this.isSelfSaving = false;
            console.error('Margo: Failed to save notes:', error);
            vscode.window.showErrorMessage('Margo: Failed to save notes file');
        } finally {
            this.isSaveLocked = false;
        }
    }

    public getNoteById(noteId: string): { note: Note; filePath: string } | undefined {
        for (const [filePath, notes] of this.notes.entries()) {
            const note = notes.find(n => n.id === noteId);
            if (note) return { note, filePath };
        }
        return undefined;
    }

    public addNote(fileUri: vscode.Uri, note: Note): void {
        const relativePath = normalizeFilePath(getRelativePath(fileUri.fsPath, this.workspaceRoot));
        const fileNotes = this.notes.get(relativePath) || [];
        fileNotes.push(note);
        this.notes.set(relativePath, fileNotes);
        this.save();
    }

    public updateNote(fileUri: vscode.Uri, noteId: string, newTitle: string, newText: string): void {
        const relativePath = normalizeFilePath(getRelativePath(fileUri.fsPath, this.workspaceRoot));
        const fileNotes = this.notes.get(relativePath);
        if (fileNotes) {
            const note = fileNotes.find(n => n.id === noteId);
            if (note) { note.title = newTitle; note.text = newText; note.timestamp = Date.now(); this.save(); }
        }
    }

    public updateNotePriority(noteId: string, priority: Priority): void {
        const result = this.getNoteById(noteId);
        if (result) { result.note.priority = priority; result.note.timestamp = Date.now(); this.save(); }
    }

    public updateNoteCategory(noteId: string, category: Category): void {
        const result = this.getNoteById(noteId);
        if (result) { result.note.category = category; result.note.timestamp = Date.now(); this.save(); }
    }

    public updateNoteStatus(noteId: string, status: NoteStatus): void {
        const result = this.getNoteById(noteId);
        if (result) { result.note.status = status; result.note.timestamp = Date.now(); this.save(); }
    }

    public updateNoteVault(noteId: string, vault: NoteVault): void {
        const result = this.getNoteById(noteId);
        if (result) {
            result.note.vault = vault;
            result.note.movedAt = Date.now();
            this.save();
            vscode.window.showInformationMessage(
                vault === 'team' ? 'Note moved to Team vault (.notes.json)' : 'Note moved to Local vault (.margo/)'
            );
        }
    }

    public deleteNote(fileUri: vscode.Uri, noteId: string): void {
        const relativePath = normalizeFilePath(getRelativePath(fileUri.fsPath, this.workspaceRoot));
        const fileNotes = this.notes.get(relativePath);
        if (fileNotes) {
            const index = fileNotes.findIndex(n => n.id === noteId);
            if (index > -1) {
                fileNotes.splice(index, 1);
                if (fileNotes.length === 0) this.notes.delete(relativePath);
                this.save();
            }
        }
    }

    public watchFile(onExternalChange: () => void): vscode.Disposable {
        const reloadHandler = async () => {
            await this.load();
            this.notifyChange();
            onExternalChange();
        };

        this.reloadDebounced = debounce(() => {
            reloadHandler().catch((err) => {
                console.error('Margo: Failed to reload on external change:', err);
            });
        }, 150);

        const onChange = () => {
            if (this.isSelfSaving) return;
            console.log('Margo: External change detected, reloading...');
            this.reloadDebounced?.();
        };

        const teamWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, TEAM_FILENAME)
        );
        teamWatcher.onDidChange(onChange);
        teamWatcher.onDidCreate(onChange);
        teamWatcher.onDidDelete(onChange);

        const localWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, `${LOCAL_DIR}/${LOCAL_FILENAME}`)
        );
        localWatcher.onDidChange(onChange);
        localWatcher.onDidCreate(onChange);
        localWatcher.onDidDelete(onChange);

        this.watchers = [teamWatcher, localWatcher];

        return new vscode.Disposable(() => {
            teamWatcher.dispose();
            localWatcher.dispose();
        });
    }

    public dispose(): void {
        for (const w of this.watchers) w.dispose();
    }
}
