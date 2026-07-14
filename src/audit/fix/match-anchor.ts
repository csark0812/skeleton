export const ANCHOR_MATCH_MIN_SCORE = 0.5;
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
	// Longer extensions of the broken slug are perfect matches
	// (`getting-started` → `getting-started-guide`).
	if (candidateSlug.startsWith(brokenSlug) && candidateSlug.length > brokenSlug.length) {
		return 1;
	}
	// Never rewrite onto a shorter heading that is only a string prefix of the
	// broken fragment (`getting-started` → `getting` / `get`).
	if (brokenSlug.startsWith(candidateSlug) && brokenSlug.length > candidateSlug.length) {
		return 0;
	}
	const a = tokenize(brokenSlug);
	const b = tokenize(candidateSlug);
	const j = jaccard(a, b);
	let intersection = 0;
	for (const token of a) {
		if (b.has(token)) intersection++;
	}
	const minSize = Math.min(a.size, b.size);
	const coverage = minSize === 0 ? 0 : intersection / minSize;
	return Math.max(j, coverage);
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
