const ignoredCategoryWords = new Set(['expense', 'expenses', 'spending', 'category', 'categories']);

const categoryAliases: Record<string, string> = {
  dining: 'dining',
  eatingout: 'dining',
  restaurant: 'dining',
  restaurants: 'dining',
  groceries: 'groceries',
  grocery: 'groceries',
};

/** Normalizes user-provided and source category names for resilient matching. */
export function normalizeCategory(value: string): string {
  const normalizedWords = value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word && !ignoredCategoryWords.has(word));

  const phrase = normalizedWords.join(' ');
  const collapsed = normalizedWords.join('');
  const singularPhrase = phrase.endsWith('s') ? phrase.slice(0, -1) : phrase;
  const singularCollapsed = collapsed.endsWith('s') ? collapsed.slice(0, -1) : collapsed;

  return (
    categoryAliases[collapsed] ??
    categoryAliases[singularCollapsed] ??
    categoryAliases[phrase] ??
    categoryAliases[singularPhrase] ??
    singularPhrase
  );
}

/** Returns true when two category labels refer to the same bookkeeping category. */
export function matchesCategory(sourceCategory: string, requestedCategory: string): boolean {
  return normalizeCategory(sourceCategory) === normalizeCategory(requestedCategory);
}
