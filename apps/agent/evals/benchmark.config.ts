interface BenchmarkModelConfiguration {
  label: string;
  modelId: string;
}

interface BenchmarkConfiguration {
  models: readonly BenchmarkModelConfiguration[];
  runCount: number;
}

export const benchmarkConfig: BenchmarkConfiguration = {
  runCount: 3,
  models: [
    { label: "GLM 5.2", modelId: "zai/glm-5.2" },
    {
      label: "DeepSeek V4 Pro",
      modelId: "deepseek/deepseek-v4-pro",
    },
  ],
};
