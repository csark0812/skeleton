DIGEST_HOURS = 24


def next_digest(last_sent_hour: int) -> int:
    return last_sent_hour + DIGEST_HOURS
