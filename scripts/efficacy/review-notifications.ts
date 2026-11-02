import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Workspace } from "@post-print/agent-test";

const NOTIFICATION_SOURCES = {
	"src/notify/quiet_hours.py": `def is_quiet(hour: int) -> bool:
    return hour >= 22 or hour < 7
`,
	"src/notify/send.py": `from notify.consent import require_opt_in
from notify.gateway import deliver


def send_push(user, message):
    require_opt_in(user)
    return deliver("push", user, message)
`,
	"src/notify/consent.py": `class OptInRequired(Exception):
    pass


def require_opt_in(user):
    if not user.opted_in:
        raise OptInRequired(user.id)
`,
	"src/notify/gateway.py": `def deliver(channel, user, message):
    return {"channel": channel, "user": user.id, "message": message}
`,
	"src/notify/digest.py": `DIGEST_HOURS = 24


def next_digest(last_sent_hour: int) -> int:
    return last_sent_hour + DIGEST_HOURS
`,
	"src/notify/unsubscribe.py": `def token_matches(token: str, expected: str) -> bool:
    return token == expected
`,
	"src/notify/format.py": `def subject_line(name: str) -> str:
    text = name.strip()
    return f"Hello {text}"
`,
	"src/audit/retention.py": `RETENTION_DAYS = 90


def expiry_day(created_day: int) -> int:
    return created_day + RETENTION_DAYS
`,
	"src/notify/log.py": `from audit.retention import expiry_day


def log_event(store, event, day):
    store.append({"event": event, "expires": expiry_day(day)})
`,
};

export function reviewNotificationsBase() {
	return {
		sources: NOTIFICATION_SOURCES,
		digestDoc:
			"Digests go out once every 24 hours. `next_digest` in `src/notify/digest.py` sets the schedule.\n",
		notifyGuide:
			"- Every path that sends a message must call `require_opt_in` first. Failure means a user who never opted in receives messages.\n- Do not comment on naming or formatting.\n",
		auditGuide:
			"- Every audit event must keep its 90-day retention. Failure means events expire before an investigation can read them.\n- Removing retention must add a line to `docs/audit/retention-changes.md`. Failure means compliance cannot trace why events disappeared.\n- Do not comment on naming or formatting.\n",
	};
}

/** The author's claim for the notifications change; it denies the unsubscribe change the commit makes. */
export const REVIEW_NOTIFICATIONS_MESSAGE = `Add SMS sending and send digests more often

Adds send_sms, moves digests to every six hours, tidies the subject helper, and
simplifies event logging. Unsubscribe behavior is unchanged.`;

const NOTIFICATION_CHANGE = {
	"src/notify/quiet_hours.py": `def is_quiet(hour: int) -> bool:
    return hour > 22 or hour < 7
`,
	"src/notify/send.py": `from notify.consent import require_opt_in
from notify.gateway import deliver


def send_push(user, message):
    require_opt_in(user)
    return deliver("push", user, message)


def send_sms(user, message):
    return deliver("sms", user, message)
`,
	"src/notify/digest.py": `DIGEST_HOURS = 6


def next_digest(last_sent_hour: int) -> int:
    return last_sent_hour + DIGEST_HOURS
`,
	"src/notify/unsubscribe.py": `def token_matches(token: str, expected: str) -> bool:
    return token.lower() == expected.lower()
`,
	"src/notify/format.py": `def subject_line(name: str) -> str:
    trimmed = name.strip()
    return f"Hello {trimmed}"
`,
	"src/notify/log.py": `def log_event(store, event, day):
    store.append({"event": event, "created": day})
`,
};

/** Commit the seeded notification defects on a feature branch in each fresh task. */
export function seedReviewNotifications(workspace: Workspace): void {
	const git = (...args: string[]) => execFileSync("git", args, { cwd: workspace.path });
	git("checkout", "-q", "-b", "feature");
	for (const [path, content] of Object.entries(NOTIFICATION_CHANGE)) {
		mkdirSync(dirname(join(workspace.path, path)), { recursive: true });
		writeFileSync(join(workspace.path, path), content);
	}
	rmSync(join(workspace.path, "src/audit/retention.py"));
	git("add", "-A", "src");
	git("commit", "-q", "-m", REVIEW_NOTIFICATIONS_MESSAGE);
}
