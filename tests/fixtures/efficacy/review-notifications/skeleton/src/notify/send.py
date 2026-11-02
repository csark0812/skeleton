from notify.consent import require_opt_in
from notify.gateway import deliver


def send_push(user, message):
    require_opt_in(user)
    return deliver("push", user, message)
