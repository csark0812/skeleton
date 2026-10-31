import { applyPayoutHold } from "../payouts/hold";

export function schedulePayout(requestedDate: Date): Date {
	return applyPayoutHold(requestedDate);
}
