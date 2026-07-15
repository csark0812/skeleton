export interface SourcePosition {
	line: number;
	column: number;
}

export interface SourceRange {
	start: SourcePosition;
	end: SourcePosition;
}

/** Convert a UTF-16 source offset to a one-based editor position. */
export function positionAtOffset(content: string, offset: number): SourcePosition {
	const bounded = Math.max(0, Math.min(offset, content.length));
	let line = 1;
	let lineStart = 0;

	for (let i = 0; i < bounded; i++) {
		if (content.charCodeAt(i) === 10) {
			line++;
			lineStart = i + 1;
		}
	}

	return { line, column: bounded - lineStart + 1 };
}

/** Build an end-exclusive, one-based source range from UTF-16 offsets. */
export function rangeFromOffsets(content: string, start: number, end: number): SourceRange {
	return {
		start: positionAtOffset(content, start),
		end: positionAtOffset(content, Math.max(start, end)),
	};
}
