# Margo

**AI-Ready Code Notes & Annotations for VS Code.**

Margo lets you attach local notes to any line of code — for review, learning, or future todos — without modifying the source file. Notes are stored as plain JSON in your workspace and structured for easy handoff to AI assistants.

The name comes from the Latin _margo_ ("margin"): notes scholars wrote in the margins of books, for the same three reasons we add them to code today.

## Features

- **Inline comment threads** on any line, editable and resolvable
- **Categories**: TODO, BUG, NOTE
- **Priorities**: High, Medium, Low
- **Two vaults**: `Local` (private, gitignored) and `Team` (shared via `.notes.json`)
- **Tree view** with grouping (by file, category, priority, status, vault) and filtering
- **Export** to Markdown or HTML
- **Copy as AI Prompt** — structured handoff to Claude, Copilot, or any LLM
- **Line tracking** — notes follow their lines as you edit
- **Hover previews** on any annotated line

## Quick start

1. Install from the Marketplace: `aikaisi.margo`
2. Open a file, right-click a line → _Add Note_ (or <kbd>Ctrl+Shift+N</kbd> / <kbd>⌘⇧N</kbd>)
3. Type your note. First line is the title, following lines are the body. Markdown is supported.
4. Open the **Margo** explorer in the activity bar to browse, filter, and export.

## Storage

| File/Folder | Purpose | Gitignored? |
| --- | --- | --- |
| `.notes.json` | Team vault — commit to share with your team | No |
| `.margo/local.notes.json` | Local vault — private, never committed | Yes (auto) |

Move notes between vaults from the comment toolbar.

## License

Margo is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0). See [LICENSE](LICENSE) for the full text.

**Commercial / non-AGPL licensing is available.** For companies that cannot comply with AGPL terms, or for embedding in proprietary products, contact **alkaisiabbas@gmail.com**.

## Links

- **Repository**: https://github.com/aikaisi/margo
- **Issues**: https://github.com/aikaisi/margo/issues
- **VS Code Marketplace**: https://marketplace.visualstudio.com/items?itemName=aikaisi.margo
- **Open VSX**: https://open-vsx.org/extension/aikaisi/margo

---

_© 2026 Abbas Al-Kaisi_
