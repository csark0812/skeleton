const SKELETON_INIT_FLAGS = new Set(["--skills", "--no-skills"]);

export interface ParsedInitArgs {
	skills: boolean;
	noSkills: boolean;
	skillsFlags: string[];
}

export function parseInitArgs(argv: string[]): ParsedInitArgs {
	if (argv.includes("--force-hooks")) {
		throw new Error("init: --force-hooks was removed with customize hooks");
	}

	const noSkills = argv.includes("--no-skills");
	const skills = argv.includes("--skills");

	const skillsFlags: string[] = [];
	let passthrough = false;

	for (const arg of argv) {
		if (arg === "--") {
			passthrough = true;
			continue;
		}
		if (!passthrough && SKELETON_INIT_FLAGS.has(arg)) continue;
		if (skills) skillsFlags.push(arg);
	}

	return { skills, noSkills, skillsFlags };
}
