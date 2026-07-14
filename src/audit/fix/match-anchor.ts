export const ANCHOR_MATCH_MIN_SCORE = 2 / 3;
export const ANCHOR_MATCH_MIN_MARGIN = 0.15;

export interface AnchorMatch {
	slug: string;
	score: number;
}

function tokenize(slug: string): Set<string> {
	return new Set(slug.split("-").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let intersection = 0;
	for (const token of a) {
		if (b.has(token)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

export function scoreAnchorMatch(brokenSlug: string, candidateSlug: string): number {
	if (brokenSlug === candidateSlug) return 1;
	// Hyphen-bounded extensions only (`getting-started` → `getting-started-guide`).
	// Raw string prefixes (`cli` → `client`) must not score perfect.
	if (candidateSlug.startsWith(`${brokenSlug}-`)) {
		return 1;
	}
	// Never rewrite onto a shorter heading that is only a string prefix of the
	// broken fragment (`getting-started` → `getting` / `get`).
	if (brokenSlug.startsWith(candidateSlug) && brokenSlug.length > candidateSlug.length) {
		return 0;
	}
	// Jaccard only — token coverage (`start` ⊂ `quick-start`) is too aggressive for autofix.
	return jaccard(tokenize(brokenSlug), tokenize(candidateSlug));
}

export function findBestAnchorMatch(
	brokenSlug: string,
	candidates: Iterable<string>,
): AnchorMatch | null {
	const scored: AnchorMatch[] = [];
	for (const slug of candidates) {
		if (slug === brokenSlug) continue;
		scored.push({ slug, score: scoreAnchorMatch(brokenSlug, slug) });
	}
	if (scored.length === 0) return null;

	scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
	const best = scored[0];
	const second = scored[1];
	if (!best || best.score < ANCHOR_MATCH_MIN_SCORE) return null;
	if (second && best.score - second.score < ANCHOR_MATCH_MIN_MARGIN) return null;
	return best;
}
