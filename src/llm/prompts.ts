import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Prompt {
  version: string;
  template: string;
}

export class PromptRegistry {
  private readonly cache = new Map<string, Prompt>();

  constructor(private readonly directory: string) {}

  get(version: string): Prompt {
    const cached = this.cache.get(version);
    if (cached) {
      return cached;
    }
    if (!/^[a-z]+\.v\d+$/.test(version)) {
      throw new Error(`Invalid prompt version "${version}"`);
    }
    const prompt = {
      version,
      template: readFileSync(join(this.directory, `${version}.md`), 'utf8'),
    };
    this.cache.set(version, prompt);
    return prompt;
  }
}

export function renderPrompt(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      throw new Error(`Prompt variable "${name}" was not provided`);
    }
    return value;
  });
}
