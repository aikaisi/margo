// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import { NoteStorage } from './noteStorage';

export class LineTracker implements vscode.Disposable {
    private disposable: vscode.Disposable;

    constructor(private storage: NoteStorage) {
        this.disposable = vscode.workspace.onDidChangeTextDocument(
            (e) => this.onDocumentChange(e)
        );
    }

    private onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
        if (e.contentChanges.length === 0) return;
        if (e.document.uri.scheme !== 'file') return;

        const notes = this.storage.getNotesForFileInternal(e.document.uri);
        if (!notes || notes.length === 0) return;

        let changed = false;

        const sortedChanges = [...e.contentChanges].sort(
            (a, b) => b.range.start.line - a.range.start.line
        );

        for (const change of sortedChanges) {
            const oldLineCount = change.range.end.line - change.range.start.line;
            const newLineCount = change.text.split('\n').length - 1;
            const delta = newLineCount - oldLineCount;

            if (delta === 0) continue;

            for (const note of notes) {
                if (note.line > change.range.end.line) {
                    note.line = Math.max(0, note.line + delta);
                    changed = true;
                } else if (
                    delta < 0 &&
                    note.line > change.range.start.line &&
                    note.line <= change.range.end.line
                ) {
                    note.line = change.range.start.line;
                    changed = true;
                }
            }
        }

        if (changed) {
            this.storage.save();
        }
    }

    dispose(): void {
        this.disposable.dispose();
    }
}
