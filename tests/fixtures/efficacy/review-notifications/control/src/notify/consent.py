class OptInRequired(Exception):
    pass


def require_opt_in(user):
    if not user.opted_in:
        raise OptInRequired(user.id)
