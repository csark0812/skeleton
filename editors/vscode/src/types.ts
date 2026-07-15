export interface SkeletonPosition {
	line: number;
	column: number;
}

export interface SkeletonRange {
	start: SkeletonPosition;
	end: SkeletonPosition;
}

export interface SkeletonIssue {
	rule: string;
	file: string;
	link?: string;
	range?: SkeletonRange;
	message: string;
	severity: "error" | "warning";
}

export interface SkeletonReport {
	label: string;
	fileCount?: number;
	errors: number;
	warnings: number;
	issues: SkeletonIssue[];
}
