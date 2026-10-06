import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

// Node's loader preserves already-exported environment variables. Never print secrets.
if (existsSync('.env')) loadEnvFile('.env');

export const config = {
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  headless: process.env.HEADLESS === '1',
  chatPort: Number(process.env.CHAT_PORT || 4200),
  maxRunCost: Number(process.env.AGENT_MAX_RUN_COST_USD || 2),
  maxTotalCost: Math.min(49.5, Number(process.env.AGENT_MAX_TOTAL_COST_USD || 49.5)),
};
if (!Number.isFinite(config.maxRunCost) || config.maxRunCost <= 0) throw new Error('INVALID_RUN_BUDGET');
if (!Number.isFinite(config.maxTotalCost) || config.maxTotalCost <= 0) throw new Error('INVALID_TOTAL_BUDGET');
if (!Number.isInteger(config.chatPort) || config.chatPort < 1 || config.chatPort > 65535) throw new Error('INVALID_CHAT_PORT');
