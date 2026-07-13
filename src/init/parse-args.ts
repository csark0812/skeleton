const SKELETON_INIT_FLAGS = new Set(["--force-hooks", "--skills", "--no-skills"]);

export interface ParsedInitArgs {
	forceHooks: boolean;
	skills: boolean;
	noSkills: boolean;
	skillsFlags: string[];
}

export function parseInitArgs(argv: string[]): ParsedInitArgs {
	const forceHooks = argv.includes("--force-hooks");
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

	return { forceHooks, skills, noSkills, skillsFlags };
}
