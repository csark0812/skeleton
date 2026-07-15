import { describe, expect, it } from "bun:test";
import { positionAtOffset, rangeFromOffsets } from "../core/source-range.ts";

describe("source ranges", () => {
	it("uses one-based UTF-16 positions", () => {
		const content = "one\n😀 two\n";

		expect(positionAtOffset(content, 0)).toEqual({ line: 1, column: 1 });
		expect(positionAtOffset(content, 4)).toEqual({ line: 2, column: 1 });
		expect(positionAtOffset(content, 6)).toEqual({ line: 2, column: 3 });
	});

	it("creates end-exclusive ranges and bounds offsets", () => {
		expect(rangeFromOffsets("abc\ndef", 4, 7)).toEqual({
			start: { line: 2, column: 1 },
			end: { line: 2, column: 4 },
		});
		expect(positionAtOffset("abc", 99)).toEqual({ line: 1, column: 4 });
	});
});
