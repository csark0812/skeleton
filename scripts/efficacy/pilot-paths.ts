import { join } from "node:path";

export function expoPilotV2Paths(root: string) {
	const taskRoot = join(
		root,
		".qualification-cache",
		"agent-workspaces",
		"expo-metro-ownership-pilot-v2",
	);
	return {
		control: join(taskRoot, "control"),
		treatment: join(taskRoot, "skeleton"),
		result: join(root, ".qualification-cache", "pilot-results", "expo-context-v2.json"),
	};
}
