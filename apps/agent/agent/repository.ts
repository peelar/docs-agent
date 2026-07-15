export interface GitHubRepository {
  id: string;
  owner: string;
  name: string;
}

export interface DocumentationRepository extends GitHubRepository {
  type: "documentation";
}

export interface EvidenceRepository extends GitHubRepository {
  type: "evidence";
}

export type Repository = DocumentationRepository | EvidenceRepository;

export interface WorkspaceRepositories {
  documentation: DocumentationRepository;
  evidence: EvidenceRepository[];
}
