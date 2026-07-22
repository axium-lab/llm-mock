export interface FixtureRule {
  match?: {
    provider?: string;
    model?: string;
    contains?: string;
    regex?: string;
  };
  response: {
    content: string;
  };
}

// Per-app fixture state, one instance per createApp() so parallel test
// servers in the same process never share rules.
export class FixtureStore {
  private rules: FixtureRule[] = [];

  register(rule: FixtureRule): void {
    this.rules.push(rule);
  }

  list(): FixtureRule[] {
    return [...this.rules];
  }

  // Without `provider`, clears everything. With it, clears only rules
  // scoped to that provider; returns how many rules were removed.
  clear(provider?: string): number {
    const before = this.rules.length;
    this.rules = provider ? this.rules.filter((rule) => rule.match?.provider !== provider) : [];
    return before - this.rules.length;
  }

  // First registered rule wins. A rule with no `match` matches everything.
  find(provider: string, model: string, prompt: string): FixtureRule | undefined {
    return this.rules.find(({ match }) => {
      if (!match) return true;
      if (match.provider && match.provider !== provider) return false;
      if (match.model && match.model !== model) return false;
      if (match.contains && !prompt.includes(match.contains)) return false;
      if (match.regex && !new RegExp(match.regex).test(prompt)) return false;
      return true;
    });
  }
}
