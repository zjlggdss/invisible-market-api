import path from 'node:path';

export function configFromEnv(env = process.env) {
  const port = (name, fallback) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${name}`);
    return value;
  };
  const ports = {
    upload: port('PORT_UPLOAD', 3101), best: port('PORT_BEST', 3102),
    worst: port('PORT_WORST', 3103), report: port('PORT_REPORT', 3104)
  };
  if (new Set(Object.values(ports)).size !== 4) throw new Error('The four ports must be distinct');
  const positiveInteger = (name, fallback) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) throw new Error(`Invalid ${name}`);
    return value;
  };
  return {
    host: env.HOST || '127.0.0.1', ports,
    agentKey: env.AGENT_API_KEY || '', ownerKey: env.OWNER_API_KEY || '',
    dashscopeKey: env.DASHSCOPE_API_KEY || '',
    dashscopeBaseUrl: env.DASHSCOPE_BASE_URL || '',
    visionModel: env.DASHSCOPE_VISION_MODEL || 'qwen3-vl-plus',
    textModel: env.DASHSCOPE_TEXT_MODEL || 'qwen-plus',
    uploadsPerDay: positiveInteger('UPLOADS_PER_DAY', 20),
    recommendationsPerDay: positiveInteger('RECOMMENDATIONS_PER_DAY', 200),
    agentRequestsPerMinute: positiveInteger('AGENT_REQUESTS_PER_MINUTE', 60),
    maxConcurrentAi: positiveInteger('MAX_CONCURRENT_AI', 4),
    dataDir: path.resolve(env.DATA_DIR || './data')
  };
}

export function assertProductionConfig(config) {
  if (!config.agentKey || config.agentKey.length < 24 || !config.ownerKey || config.ownerKey.length < 24 ||
      config.agentKey === config.ownerKey || !config.dashscopeKey || config.dashscopeKey === 'your-alibaba-cloud-model-studio-api-key') {
    throw new Error('Set distinct AGENT_API_KEY and OWNER_API_KEY (at least 24 characters), plus DASHSCOPE_API_KEY');
  }
  if (!config.dashscopeBaseUrl || config.dashscopeBaseUrl.includes('YOUR_WORKSPACE_ID')) {
    throw new Error('Set DASHSCOPE_BASE_URL to your workspace-specific Alibaba Cloud HTTPS endpoint');
  }
  const url = new URL(config.dashscopeBaseUrl);
  if (url.protocol !== 'https:') throw new Error('DASHSCOPE_BASE_URL must use HTTPS');
}
