from audit.retention import expiry_day


def log_event(store, event, day):
    store.append({"event": event, "expires": expiry_day(day)})
