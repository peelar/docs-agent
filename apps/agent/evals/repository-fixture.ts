import { normalizeRepositoryConfiguration } from "../repositories/configuration/normalize";

const repositoryUrls = {
  documentation: "https://github.com/peelar/saleor-docs",
  evidence: {
    core: "https://github.com/saleor/saleor",
    dashboard: "https://github.com/saleor/saleor-dashboard",
  },
} as const;

const normalizedConfiguration = normalizeRepositoryConfiguration({
  documentationRepositoryUrl: repositoryUrls.documentation,
  evidenceRepositoryUrls: [
    repositoryUrls.evidence.core,
    repositoryUrls.evidence.dashboard,
  ],
}).match(
  (configuration) => configuration,
  (error) => {
    throw error;
  },
);

const evidenceRepositoriesByName = Object.fromEntries(
  normalizedConfiguration.evidenceRepositories.map((repository) => [
    repository.name,
    repository,
  ]),
);

export const repositoryEvalFixture = {
  urls: repositoryUrls,
  configuration: normalizedConfiguration,
  repositories: {
    documentation: normalizedConfiguration.documentationRepository,
    core: requireRepository("saleor"),
    dashboard: requireRepository("saleor-dashboard"),
  },
  pullRequest: {
    number: 6744,
    url: "https://github.com/saleor/saleor-dashboard/pull/6744",
    baseSha: "10a8de56965b5b33a74c379d4147476c0c2c2fb5",
    headSha: "723e17e5e789d8824d89ced25cf36ccc3714d919",
    changedPath: ".changeset/tough-candies-dig.md",
  },
  documentation: {
    stockOverviewUrl: "https://docs.saleor.io/developer/stock/overview",
  },
} as const;

function requireRepository(name: string) {
  const repository = evidenceRepositoriesByName[name];
  if (repository === undefined) {
    throw new Error(`Missing ${name} from the repository eval fixture.`);
  }
  return repository;
}
