import type { ProviderID } from '@nemi/shared';
import type { AgentProvider } from './types';
import { claudeProvider } from './claude';
import { codexProvider } from './codex';
import { opencodeProvider } from './opencode';

export * from './types';

export const PROVIDERS: Record<ProviderID, AgentProvider> = {
  claude: claudeProvider,
  codex: codexProvider,
  opencode: opencodeProvider,
};

export const PROVIDER_ORDER: ProviderID[] = ['claude', 'codex', 'opencode'];
