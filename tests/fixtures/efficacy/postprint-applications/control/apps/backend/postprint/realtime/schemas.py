from typing import Literal

from pydantic import BaseModel


class WorkspaceDocumentUpdatedData(BaseModel):
    document_id: str
    project_id: str
    event: Literal["workspace.document_updated"] = "workspace.document_updated"
