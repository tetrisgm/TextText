import { workspacePublicBaseUrl } from "@/lib/public-paths";

export type AccountDeletionOverview = {
  identities: string[];
  email: string | null;
  username: string | null;
  handle: string;
  workspaceName: string;
  documents: number;
  publishedDocuments: number;
  collaborators: number;
  apiTokens: number;
  hasCloudAiKey: boolean;
  confirmationPhrase: string;
};

export function accountDeletionConsequences(
  account: AccountDeletionOverview,
): string[] {
  const consequences: string[] = [];
  if (account.documents > 0) {
    consequences.push(
      `${account.documents} ${account.documents === 1 ? "document is" : "documents are"} deleted, with their images, files, and drafts.`,
    );
  }
  consequences.push(
    `The workspace ${account.workspaceName} is deleted, with its folders and Trash.`,
  );
  if (account.publishedDocuments > 0) {
    const publicHost = new URL(workspacePublicBaseUrl(account.handle)).host;
    consequences.push(
      `Published pages at ${publicHost} stop working. That workspace address stays reserved, so nobody can publish at your old links.`,
    );
  }
  if (account.collaborators > 0) {
    consequences.push(
      `${account.collaborators} ${account.collaborators === 1 ? "person" : "people"} you share with lose access, and comments they wrote on your documents are deleted too.`,
    );
  }
  if (account.apiTokens > 0) {
    consequences.push(
      `${account.apiTokens} API ${account.apiTokens === 1 ? "token" : "tokens"} stop working. TextText on your other devices signs out.`,
    );
  }
  if (account.hasCloudAiKey) {
    consequences.push("Your saved cloud AI key is deleted.");
  }
  return consequences;
}
