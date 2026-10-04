#!/usr/bin/env python3
"""Reproduce the 2026-10-04 guidance incident through public CLI boundaries.

No application install, network, hooks, or edits to supplied checkouts. Fixtures
and the optional immutable PostPrint replay live in an automatically removed
temporary directory. Raw receipts and a summary remain in --output.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timezone


STALE = "e04277ea94744fc4d6fa88b690135b417f07bd29"
RECONCILED = "3c6f47af806fab7ef897ae72d70dea977165de8a"
DELETION = "bf40bb3b3e90456e4e3e2b56e48bfb1ff898cb56"
PAPERS = [
    "docs/product/object-model.md",
    "docs/product/north-star-alignment-gameplan.md",
    "docs/product/note-model-exploration.md",
    "docs/product/decisions/README.md",
]
QUERY = "documentation drift annotation product model incident"


def write(root, path, text):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


def execute(command, root):
    env = {**os.environ, "TZ": "UTC"}
    # Local catalog generation is part of this replay, regardless of host CI.
    env.pop("CI", None)
    # A file sink avoids Node process.exit truncating a large buffered pipe write.
    with (
        tempfile.TemporaryFile(mode="w+") as stdout,
        tempfile.TemporaryFile(mode="w+") as stderr,
    ):
        result = subprocess.run(
            command,
            cwd=root,
            env=env,
            stdout=stdout,
            stderr=stderr,
            text=True,
            timeout=180,
        )
        stdout.seek(0)
        stderr.seek(0)
        return subprocess.CompletedProcess(
            command, result.returncode, stdout.read(), stderr.read()
        )


def must(command, root):
    result = execute(command, root)
    if result.returncode:
        raise RuntimeError(f"{command}: {result.stderr or result.stdout}")
    return result.stdout


def document(title, summary, date, body, dependency=None):
    deps = f"<!-- review-deps: paths={dependency} -->\n\n" if dependency else ""
    return (
        f"# {title}\n\n<!-- source-of-truth: {summary} -->\n\n"
        f"<!-- doc-meta: owner=eng | last-reviewed={date} -->\n\n{deps}{body}\n"
    )


def initialize(root):
    must(["git", "init", "-q"], root)
    must(["git", "config", "user.name", "Incident fixture"], root)
    must(["git", "config", "user.email", "fixture@example.invalid"], root)
    # Ensure a globally configured hooksPath cannot execute user hooks.
    must(["git", "config", "core.hooksPath", "/dev/null"], root)
    must(["git", "add", "."], root)
    must(["git", "commit", "-q", "-m", "fixture baseline"], root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cli",
        required=True,
        type=Path,
        help="Installed dist/cli.js or current src/cli.ts",
    )
    parser.add_argument("--runtime", choices=["node", "bun"], default="node")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--expect-prevention",
        action="store_true",
        help="Require actionable review and omission evidence from the candidate fix",
    )
    parser.add_argument(
        "--postprint",
        type=Path,
        help="Optional local repository containing pinned commits",
    )
    args = parser.parse_args()
    cli = args.cli.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    prefix = [args.runtime, str(cli)]
    receipts = []

    def run(name, root, argv, expected=None):
        result = execute(prefix + argv, root)
        (output / f"{name}.stdout").write_text(result.stdout)
        (output / f"{name}.stderr").write_text(result.stderr)
        receipt = {
            "name": name,
            "command": prefix + argv,
            "exitCode": result.returncode,
        }
        if argv[:2] == ["audit", "docs"] and "--json" in argv:
            audit = json.loads(result.stdout)
            receipt.update(
                diagnostics=audit["diagnostics"],
                rules=audit["rules"],
                reviewProof=audit["reviewProof"],
            )
        if argv[0] == "context":
            receipt["headers"] = [
                line
                for line in result.stdout.splitlines()
                if line.startswith(
                    ("document\t", "omitted\t", "action\t", "no-context\t")
                )
            ]
        receipts.append(receipt)
        if expected is not None and result.returncode != expected:
            raise AssertionError(
                f"{name}: expected exit {expected}, got {result.returncode}; see {output}"
            )
        return result

    try:
        with tempfile.TemporaryDirectory(
            prefix="skeleton-guidance-incident-"
        ) as temporary:
            scratch = Path(temporary)
            date = datetime.now(timezone.utc).date().isoformat()
            config = 'daysUntilStale = 180\n[scan]\ninclude = ["docs/**"]\nexclude = []\n[reviewCoverage]\ninclude = []\n'
            model = "class Annotation:\n    kinds = ('comment', 'task')\n\nclass DocumentVersion:\n    pass\n\nclass DocumentEditIntent:\n    pass\n"
            stale = "Research ownership uses DocumentSourceRef evidence refs. /cite is the primary capture path. Annotations are legacy and should retire."
            reconciled = "Research ownership uses annotations, versioned documents, and document edit intents. Captured evidence is distinct from a future synthesis citation relationship."
            history = "Historical alternatives record the superseded DocumentSourceRef and /cite design. They do not prescribe current research ownership."
            future = "Future citation aspirations remain unresolved. A claim-to-source relationship needs a product decision; it is not an implemented capability."
            for state, body in [("stale", stale), ("reconciled", reconciled)]:
                root = scratch / state
                root.mkdir()
                write(root, "skeleton.toml", config)
                write(root, "src/models.py", model)
                write(
                    root,
                    "docs/model.md",
                    document("Research ownership", "Research ownership", date, body),
                )
                write(
                    root,
                    "docs/history.md",
                    document(
                        "Historical alternatives",
                        "Historical alternatives",
                        date,
                        history,
                    ),
                )
                write(
                    root,
                    "docs/future.md",
                    document(
                        "Future citation aspirations",
                        "Future citation aspirations",
                        date,
                        future,
                    ),
                )
                initialize(root)
                run(f"minimal-{state}-catalog", root, ["catalog"], 0)
                run(
                    f"minimal-{state}-audit",
                    root,
                    ["audit", "docs", "--strict", "--json"],
                    0,
                )
                context = run(
                    f"minimal-{state}-context",
                    root,
                    ["context", "research ownership"],
                    0,
                )
                assert "document\tdocs/model.md\tunreviewed" in context.stdout
                assert (
                    "action\tdocs/model.md" in context.stdout
                ) == args.expect_prevention
                if args.expect_prevention:
                    assert "active implementation claims" in context.stdout
                    assert (
                        "historical alternatives and future aspirations"
                        in context.stdout
                    )
                history_result = run(
                    f"minimal-{state}-history",
                    root,
                    ["context", "historical alternatives"],
                    0,
                )
                future_result = run(
                    f"minimal-{state}-future",
                    root,
                    ["context", "future citation aspirations"],
                    0,
                )
                assert "document\tdocs/history.md" in history_result.stdout
                assert "document\tdocs/future.md" in future_result.stdout
                missing = run(
                    f"minimal-{state}-no-owner",
                    root,
                    ["context", "--path=src/models.py"],
                    0,
                )
                assert "no-context\tno canonical document matched" in missing.stdout
                run(
                    f"minimal-{state}-code-validation",
                    root,
                    ["validate", "changed", "src/models.py"],
                    1,
                )
                write(
                    root,
                    "skeleton.toml",
                    config.replace(
                        "[reviewCoverage]\ninclude = []",
                        '[reviewCoverage]\ninclude = ["src/models.py"]',
                    ),
                )
                uncovered = run(
                    f"minimal-{state}-coverage-enabled",
                    root,
                    ["validate", "changed", "src/models.py"],
                    1,
                )
                assert (
                    "no scanned document claims this path"
                    in uncovered.stdout + uncovered.stderr
                )

            # Same public CLI with a declared owner does enforce review on code change.
            root = scratch / "declared-owner"
            root.mkdir()
            write(root, "skeleton.toml", config)
            write(
                root, "src/models.py", model + "\nclass DocumentSourceRef:\n    pass\n"
            )
            write(
                root,
                "docs/model.md",
                document(
                    "Research ownership",
                    "Research ownership",
                    date,
                    stale,
                    "src/models.py",
                ),
            )
            initialize(root)
            run("owner-date-baseline", root, ["audit", "docs", "--strict", "--json"], 0)
            write(root, "src/models.py", model)
            run(
                "owner-date-invalidated",
                root,
                ["validate", "changed", "src/models.py"],
                1,
            )
            assert (
                "docs/model.md"
                in (output / "owner-date-invalidated.stdout").read_text()
            )
            write(
                root, "src/models.py", model + "\nclass DocumentSourceRef:\n    pass\n"
            )
            write(root, "skeleton.toml", config + '[reviewProof]\nmode = "hash"\n')
            # Fixture setup attests exact baseline bytes; this is not a human-review claim.
            run(
                "owner-hash-baseline",
                root,
                [
                    "audit",
                    "docs",
                    "--paths=docs/model.md",
                    "--fix=doc-meta",
                    "--confirm-reviewed",
                ],
                0,
            )
            write(root, "src/models.py", model)
            result = run(
                "owner-hash-invalidated",
                root,
                ["audit", "docs", "--strict", "--json"],
                1,
            )
            assert any(
                d["code"] == "review-dependency-changed"
                for d in json.loads(result.stdout)["diagnostics"]
            )
            context = run(
                "owner-hash-context", root, ["context", "research ownership"], 0
            )
            assert (
                "changed-since-review" in context.stdout
                and "action\tdocs/model.md" in context.stdout
            )

            if args.postprint:
                repo = args.postprint.resolve(strict=True)
                root = scratch / "postprint"
                must(
                    ["git", "clone", "--shared", "--no-checkout", str(repo), str(root)],
                    scratch,
                )
                must(["git", "config", "core.hooksPath", "/dev/null"], root)
                changes = must(
                    ["git", "diff", "--name-only", STALE, RECONCILED], root
                ).splitlines()
                for state, revision in [("stale", STALE), ("reconciled", RECONCILED)]:
                    must(["git", "checkout", "--detach", revision], root)
                    assert must(["git", "rev-parse", "HEAD"], root).strip() == revision
                    paths = PAPERS if state == "stale" else changes
                    run(f"postprint-{state}-catalog", root, ["catalog"], 0)
                    run(
                        f"postprint-{state}-catalog-check",
                        root,
                        ["catalog", "--check", "--strict"],
                        0,
                    )
                    run(
                        f"postprint-{state}-audit",
                        root,
                        [
                            "audit",
                            "docs",
                            f"--paths={','.join(paths)}",
                            "--strict",
                            "--json",
                        ],
                        1 if state == "stale" else 0,
                    )
                    run(
                        f"postprint-{state}-global-audit",
                        root,
                        ["audit", "docs", "--strict", "--json"],
                    )
                    packet = run(
                        f"postprint-{state}-context", root, ["context", QUERY], 0
                    )
                    if args.expect_prevention:
                        assert "action\tomitted\t" in packet.stdout
                        assert "docs/product/object-model.md" in packet.stdout
                        if state == "stale":
                            assert (
                                "action\tdocs/product/north-star-alignment-gameplan.md\tReview required:"
                                in packet.stdout
                            )
                    expanded = run(
                        f"postprint-{state}-context-expanded",
                        root,
                        ["context", QUERY, "--max-chars=1000000"],
                        0,
                    )
                    if args.expect_prevention:
                        assert (
                            "document\tdocs/product/object-model.md\t"
                            in expanded.stdout
                        )
                        assert (
                            "action\tdocs/product/object-model.md\t" in expanded.stdout
                        )
                    run(
                        f"postprint-{state}-model-path",
                        root,
                        ["context", "--path=apps/backend/postprint/papers/models.py"],
                        0,
                    )
                    run(
                        f"postprint-{state}-model-validation",
                        root,
                        [
                            "validate",
                            "changed",
                            "apps/backend/postprint/papers/models.py",
                        ],
                        1,
                    )
                    run(
                        f"postprint-{state}-migration-validation",
                        root,
                        [
                            "validate",
                            "changed",
                            "apps/backend/postprint/papers/migrations/0091_delete_documentsourceref.py",
                        ],
                        1,
                    )
                must(["git", "checkout", "--detach", DELETION], root)
                run(
                    "postprint-deletion-impact",
                    root,
                    ["validate", "changed", "--base=" + DELETION + "^"],
                    1,
                )
    finally:
        summary = {
            "cli": str(cli),
            "runtime": args.runtime,
            "expectPrevention": args.expect_prevention,
            "cliSha256": hashlib.sha256(cli.read_bytes()).hexdigest(),
            "postprintRevisions": {
                "stale": STALE,
                "reconciled": RECONCILED,
                "deletion": DELETION,
            },
            "receipts": receipts,
        }
        (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"Reproduction assertions passed; {len(receipts)} CLI receipts in {output}")


if __name__ == "__main__":
    main()
