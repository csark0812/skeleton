const documentUpdateInvalidations = [
	"projectDocuments",
	"documentDetail",
	"documentContent",
	"workspaceFolders",
] as const;

export const projectUpdateHandlers = {
	"workspace.document_updated": documentUpdateInvalidations,
};
