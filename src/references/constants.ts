export const CANONICAL_REFS_DIR = ".skeleton/references";

export const GENERATED_MARKER_START = "<!-- skeleton: generated-reference";

export const GENERATED_MARKER_RE =
	/<!-- skeleton: generated-reference\s*\nsource: ([^\n]+)\s*\nredundancy: intentional\s*\n-->\s*\n?/;

/** Markdown links targeting the old shared root references/ tree. */
export const SHARED_REF_LINK_RE = /\((?:\.\.\/)+references\/([^)]+)\)/g;

export function formatGeneratedHeader(sourceRelPath: string): string {
	return `${GENERATED_MARKER_START}
source: ${sourceRelPath}
redundancy: intentional
-->

`;
}

export function stripGeneratedHeader(content: string): string {
	return content.replace(GENERATED_MARKER_RE, "");
}

export function parseGeneratedSource(content: string): string | null {
	const match = content.match(GENERATED_MARKER_RE);
	return match?.[1] ?? null;
}

export function isGeneratedReference(content: string): boolean {
	return content.startsWith(GENERATED_MARKER_START);
}
