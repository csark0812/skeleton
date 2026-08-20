/** Fixture consumer plugin for skeleton Phase 1.5 tests. */
export const rules = [{ id: "fixture-fingerprint", run: () => [] }];

export const policies = ["plugins/example/policies/*.yaml"];

export default { rules, policies };
