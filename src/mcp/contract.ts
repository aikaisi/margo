// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
//
// MCP server contract. The actual implementation ships as a separate
// closed-source npm package (margo-mcp). This file defines the API
// surface the extension expects — the boundary between free core and
// proprietary MCP integration.

import { Note } from '../utils';

export interface McpStartOptions {
    workspaceRoot: string;
    getAllNotes: () => Map<string, Note[]>;
    port?: number;
}

export interface MargoMcpServer {
    start(options: McpStartOptions): Promise<void>;
    stop(): Promise<void>;
}

export type McpServerFactory = () => MargoMcpServer;
