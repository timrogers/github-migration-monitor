export interface Opts {
  githubToken?: string;
  organization: string;
  intervalInSeconds: number;
  since?: string;
}

export interface RepositoryMigration {
  id: string;
  createdAt: string;
  failureReason?: string;
  repositoryName: string;
  state: string;
}

// Taken from https://docs.github.com/en/graphql/reference/enums#migrationstate
export enum MigrationState {
  QUEUED = 'QUEUED',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  NOT_STARTED = 'NOT_STARTED',
  FAILED_VALIDATION = 'FAILED_VALIDATION'
};