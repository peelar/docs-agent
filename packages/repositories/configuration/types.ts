import type {
  DocumentationRepository,
  RepositoryConfig,
} from "../types.js";

export interface RepositoryConfigurationData {
  documentationRepository: DocumentationRepository;
  evidenceRepositories: RepositoryConfig[];
}

export interface ActiveRepositoryConfiguration
  extends RepositoryConfigurationData {
  revision: number;
  updatedAt: string;
}

export interface SaveRepositoryConfigurationInput {
  configuration: RepositoryConfigurationData;
  expectedRevision: number | null;
}
