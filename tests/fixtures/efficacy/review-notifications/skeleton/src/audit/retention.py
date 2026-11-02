RETENTION_DAYS = 90


def expiry_day(created_day: int) -> int:
    return created_day + RETENTION_DAYS
