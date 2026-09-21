'use strict';

// LLM 适配层的类型：由 packages/llm-adapters 自己拥有，应用侧再导出使用。
// 这样做的好处是适配层可以独立编译、独立测试；应用侧不需要为了类型去依赖这份实现。

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: RawToolCall[];
  name?: string;
  tool_call_id?: string;
}

export interface RawToolCall {
  id?: string;
  type?: string;
  function: { name: string; arguments: unknown };
}

export interface NormalizedToolCall {
  name: string;
  args: Record<string, unknown>;
  raw: RawToolCall;
}

export interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ToolCallReply {
  content: string;
  toolCalls: NormalizedToolCall[];
  rawToolCalls: RawToolCall[];
  /** 服务端上报的 token 用量：Agent 的 token 预算与成本统计靠它（此前被丢弃，预算等于失效） */
  usage?: LlmUsage;
}

export type LlmClient = {
  readonly provider: 'ollama' | 'cloud' | 'embedded';
  readonly config: LlmConfig;
  status(): Promise<LlmStatus>;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string | ToolCallReply>;
};

export interface LlmConfig {
  provider?: 'cloud' | 'embedded';
  endpoint: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  timeout?: number;
  jsonMode?: boolean;
}

export interface LlmStatus {
  available: boolean;
  models: string[];
  error?: string;
}

export interface ChatOptions {
  onChunk?: (piece: string) => void;
  tools?: Array<Record<string, unknown>>;
}
