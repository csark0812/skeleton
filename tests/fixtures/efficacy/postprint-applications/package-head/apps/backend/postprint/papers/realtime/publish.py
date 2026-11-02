def publish_document_updated(*, transaction, document_id: str, project_id: str) -> None:
    transaction.on_commit(
        lambda: broadcast("workspace.document_updated", {"document_id": document_id, "project_id": project_id})
    )
