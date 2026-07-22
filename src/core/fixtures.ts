export interface FixtureRule {
  match?: {
    model?: string;
    contains?: string;
    regex?: string;
  };
  response: {
    content: string;
  };
}

const fixtures: FixtureRule[] = [];

export function registerFixture(rule: FixtureRule): void {
  fixtures.push(rule);
}

export function clearFixtures(): void {
  fixtures.length = 0;
}

// First registered rule wins. A rule with no `match` matches everything.
export function findFixture(model: string, prompt: string): FixtureRule | undefined {
  return fixtures.find(({ match }) => {
    if (!match) return true;
    if (match.model && match.model !== model) return false;
    if (match.contains && !prompt.includes(match.contains)) return false;
    if (match.regex && !new RegExp(match.regex).test(prompt)) return false;
    return true;
  });
}
