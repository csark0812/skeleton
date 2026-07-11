export const SKILLS_SOURCE = "csark0812/skeleton";

const DEFAULT_SKILL = "skeleton";
const DEFAULT_AGENTS = ["cursor", "claude-code"];

export interface SkillsAddOptions {
	skillsFlags?: string[];
}

function hasFlag(flags: string[], names: string[]): boolean {
	for (let i = 0; i < flags.length; i++) {
		const flag = flags[i];
		for (const name of names) {
			if (flag === name || flag.startsWith(`${name}=`)) return true;
		}
	}
	return false;
}

function mergeSkillsDefaults(flags: string[]): string[] {
	if (flags.includes("--all")) {
		return hasFlag(flags, ["-y", "--yes"]) ? flags : [...flags, "-y"];
	}
	if (hasFlag(flags, ["-l", "--list"])) return flags;

	const merged = [...flags];
	if (!hasFlag(merged, ["--skill", "-s"])) {
		merged.push("--skill", DEFAULT_SKILL);
	}
	if (!hasFlag(merged, ["-a", "--agent"])) {
		merged.push("-a", ...DEFAULT_AGENTS);
	}
	if (!hasFlag(merged, ["-y", "--yes"])) {
		merged.push("-y");
	}
	return merged;
}

export function skillsAddArgs(options: SkillsAddOptions = {}): string[] {
	const userFlags = [...(options.skillsFlags ?? [])];
	return ["skills", "add", SKILLS_SOURCE, ...mergeSkillsDefaults(userFlags)];
}
