export interface RepositoryMigration {
  id: string;
  createdAt: string;
  failureReason?: string;
  repositoryName: string;
  state: string;
}