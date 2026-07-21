import { describe, expect, it } from "vitest";

import {
  type BenchmarkModelResult,
  benchmarkSectionEnd,
  benchmarkSectionStart,
  renderBenchmarkSection,
  replaceBenchmarkSection,
} from "../evals/benchmark-report";

const models: readonly BenchmarkModelResult[] = [
  {
    label: "Reliable Model",
    modelId: "example/reliable",
    runs: [
      run({ behaviorPassed: 10, safetyPassed: 6, costUsd: 0.1 }),
      run({ behaviorPassed: 9, safetyPassed: 6, costUsd: 0.2 }),
      run({ behaviorPassed: 10, safetyPassed: 6, costUsd: 0.3 }),
    ],
  },
  {
    label: "Unsafe Model",
    modelId: "example/unsafe",
    runs: [
      run({ behaviorPassed: 10, safetyPassed: 5, costUsd: 0.01 }),
      run({ behaviorPassed: 10, safetyPassed: 6, costUsd: 0.01 }),
      run({ behaviorPassed: 10, safetyPassed: 6, costUsd: 0.01 }),
    ],
  },
];

describe("benchmark report", () => {
  it("keeps safety separate and does not average away a failed safety run", () => {
    const report = renderBenchmarkSection(
      new Date("2026-07-21T12:00:00.000Z"),
      models,
    );

    expect(report).toContain("Updated 21 July 2026 from 3 repeated runs");
    expect(report).toContain(
      "| Reliable Model | 29/30 cases; 29/30 gates | 18/18 cases; 18/18 gates | 2/3 | $0.200 | 2m 00s | Safety passed; behavior varied |",
    );
    expect(report).toContain(
      "| Unsafe Model | 30/30 cases; 30/30 gates | 17/18 cases; 17/18 gates | 2/3 | $0.010 | 2m 00s | Not qualified |",
    );
  });

  it("replaces only the generated section", () => {
    const original = `# Intro\n\nHuman text.\n\n${benchmarkSectionStart}\nold\n${benchmarkSectionEnd}\n\n## Method\n\nKeep me.\n`;
    const section = renderBenchmarkSection(
      new Date("2026-07-21T12:00:00.000Z"),
      models,
    );

    const updated = replaceBenchmarkSection(original, section);

    expect(updated).toContain("Human text.");
    expect(updated).toContain("## Method\n\nKeep me.");
    expect(updated).not.toContain("\nold\n");
  });

  it("refuses to update a document without result markers", () => {
    expect(() => replaceBenchmarkSection("# Evals\n", "replacement"))
      .toThrow(/missing its benchmark result markers/);
  });
});

function run(input: {
  behaviorPassed: number;
  safetyPassed: number;
  costUsd: number;
}) {
  return {
    behavior: {
      passed: input.behaviorPassed,
      total: 10,
      gatePassed: input.behaviorPassed,
      gateTotal: 10,
      costUsd: input.costUsd * 0.75,
      durationSeconds: 90,
    },
    safety: {
      passed: input.safetyPassed,
      total: 6,
      gatePassed: input.safetyPassed,
      gateTotal: 6,
      costUsd: input.costUsd * 0.25,
      durationSeconds: 30,
    },
  };
}
