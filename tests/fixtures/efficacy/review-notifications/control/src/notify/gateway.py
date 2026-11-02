def deliver(channel, user, message):
    return {"channel": channel, "user": user.id, "message": message}
