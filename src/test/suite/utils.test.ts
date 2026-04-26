// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as assert from 'assert';
import {
    createNote,
    migrateNote,
    normalizeFilePath,
    getRelativePath,
    getAbsolutePath,
    matchesFilter,
    Note,
    FilterState,
} from '../../utils';

suite('Utils', () => {
    test('createNote returns a valid note with defaults', () => {
        const note = createNote(10, 'test title', 'test note', 'testuser');
        assert.strictEqual(note.line, 10);
        assert.strictEqual(note.title, 'test title');
        assert.strictEqual(note.text, 'test note');
        assert.strictEqual(note.author, 'testuser');
        assert.strictEqual(note.priority, 'medium');
        assert.strictEqual(note.category, 'note');
        assert.strictEqual(note.status, 'open');
        assert.strictEqual(note.vault, 'local');
        assert.ok(note.id);
        assert.ok(note.timestamp > 0);
    });

    test('createNote respects custom priority and category', () => {
        const note = createNote(5, 'Bug title', 'bug found', 'dev', 'high', 'bug');
        assert.strictEqual(note.priority, 'high');
        assert.strictEqual(note.category, 'bug');
    });

    test('migrateNote fills missing fields with defaults', () => {
        const old = { id: 'abc', line: 3, text: 'old note' };
        const migrated = migrateNote(old);
        assert.strictEqual(migrated.id, 'abc');
        assert.strictEqual(migrated.line, 3);
        assert.strictEqual(migrated.text, 'old note');
        assert.strictEqual(migrated.priority, 'medium');
        assert.strictEqual(migrated.category, 'note');
        assert.strictEqual(migrated.status, 'open');
        assert.strictEqual(migrated.vault, 'local');
        assert.strictEqual(migrated.author, 'Unknown');
    });

    test('migrateNote preserves existing fields', () => {
        const existing = {
            id: 'x', line: 1, text: 'hi',
            timestamp: 1000, author: 'bob',
            priority: 'high' as const, category: 'bug' as const,
            status: 'resolved' as const,
            vault: 'team' as const,
        };
        const migrated = migrateNote(existing);
        assert.strictEqual(migrated.timestamp, 1000);
        assert.strictEqual(migrated.author, 'bob');
        assert.strictEqual(migrated.priority, 'high');
        assert.strictEqual(migrated.status, 'resolved');
        assert.strictEqual(migrated.vault, 'team');
    });

    test('normalizeFilePath converts backslashes', () => {
        assert.strictEqual(normalizeFilePath('src\\utils.ts'), 'src/utils.ts');
        assert.strictEqual(normalizeFilePath('src/utils.ts'), 'src/utils.ts');
    });

    test('getRelativePath produces ./prefixed paths', () => {
        const rel = getRelativePath('/workspace/src/file.ts', '/workspace');
        assert.strictEqual(rel, './src/file.ts');
    });

    test('getAbsolutePath resolves correctly', () => {
        const abs = getAbsolutePath('./src/file.ts', '/workspace');
        assert.ok(abs.endsWith('src/file.ts'));
    });

    suite('matchesFilter', () => {
        const makeNote = (overrides: Partial<Note> = {}): Note => ({
            id: '1', line: 0, title: 'Test', text: 'hello', timestamp: 0,
            author: 'user', priority: 'medium', category: 'note', status: 'open', vault: 'local',
            ...overrides,
        });

        test('empty filter matches everything', () => {
            assert.ok(matchesFilter(makeNote(), {}));
        });

        test('filters by category', () => {
            const filter: FilterState = { categories: ['bug', 'todo'] };
            assert.ok(matchesFilter(makeNote({ category: 'bug' }), filter));
            assert.ok(!matchesFilter(makeNote({ category: 'note' }), filter));
        });

        test('filters by priority', () => {
            const filter: FilterState = { priorities: ['high'] };
            assert.ok(matchesFilter(makeNote({ priority: 'high' }), filter));
            assert.ok(!matchesFilter(makeNote({ priority: 'low' }), filter));
        });

        test('filters by status', () => {
            const filter: FilterState = { statuses: ['resolved'] };
            assert.ok(matchesFilter(makeNote({ status: 'resolved' }), filter));
            assert.ok(!matchesFilter(makeNote({ status: 'open' }), filter));
        });

        test('filters by text search', () => {
            const filter: FilterState = { textSearch: 'hello' };
            assert.ok(matchesFilter(makeNote({ text: 'say hello world' }), filter));
            assert.ok(!matchesFilter(makeNote({ text: 'goodbye' }), filter));
        });

        test('text search is case-insensitive', () => {
            const filter: FilterState = { textSearch: 'HELLO' };
            assert.ok(matchesFilter(makeNote({ text: 'hello there' }), filter));
        });

        test('combined filters are AND-ed', () => {
            const filter: FilterState = { categories: ['bug'], priorities: ['high'] };
            assert.ok(matchesFilter(makeNote({ category: 'bug', priority: 'high' }), filter));
            assert.ok(!matchesFilter(makeNote({ category: 'bug', priority: 'low' }), filter));
            assert.ok(!matchesFilter(makeNote({ category: 'note', priority: 'high' }), filter));
        });
    });
});
