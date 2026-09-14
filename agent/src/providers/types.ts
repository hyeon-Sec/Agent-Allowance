import type { AgentTool } from "../agent-tools.js";
import type { ProviderOption } from "../ai-config.js";
import type { ChatTurn } from "../chat-types.js";
export interface ToolCall { id: string; name: string; input: unknown; }
export interface ToolResult { id: string; name: string; output: string; isError?: boolean; }
export interface ModelTurn { text: string; reasoning: string; toolCalls: ToolCall[]; }
export interface ModelSession { next(results: ToolResult[]): Promise<ModelTurn>; }
export interface SessionOptions {
  provider: ProviderOption;
  system: string;
  messages: ChatTurn[];
  tools: AgentTool[];
}
