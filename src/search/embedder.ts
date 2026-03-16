/**
 * Embedder — Transformer-based text embedding
 *
 * Uses @huggingface/transformers (transformers.js) to generate
 * vector embeddings from text. The model is lazy-loaded on first use.
 *
 * Default model: Snowflake/snowflake-arctic-embed-xs (22M params, 384 dims)
 * This is a tiny but effective model for code search.
 *
 * The @huggingface/transformers package is optional — if not installed,
 * embedding functions throw an error with install instructions.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface EmbedderConfig {
  modelId: string;
  dimensions: number;
}

export const DEFAULT_CONFIG: EmbedderConfig = {
  modelId: 'Snowflake/snowflake-arctic-embed-xs',
  dimensions: 384,
};

// ─── Pipeline Management ────────────────────────────────────────

let _pipeline: any = null;
let _currentModel: string | null = null;

/**
 * Initialize the embedding pipeline. Lazy-loads the model.
 */
export async function initEmbedder(config: EmbedderConfig = DEFAULT_CONFIG): Promise<void> {
  if (_pipeline && _currentModel === config.modelId) return;

  let transformers: any;
  try {
    // Dynamic import — optional dependency
    transformers = await (Function('return import("@huggingface/transformers")')() as Promise<any>);
  } catch {
    throw new Error(
      'Embeddings require @huggingface/transformers. Install with:\n' +
      '  npm install @huggingface/transformers',
    );
  }

  _pipeline = await transformers.pipeline('feature-extraction', config.modelId, {
    dtype: 'fp32',
  });
  _currentModel = config.modelId;
}

/**
 * Embed a single text string. Returns a Float32Array.
 * Throws if initEmbedder() hasn't been called.
 */
export async function embedText(text: string): Promise<Float32Array> {
  if (!_pipeline) {
    throw new Error('Embedder not initialized. Call initEmbedder() first.');
  }

  const output = await _pipeline(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

/**
 * Embed a batch of texts. Returns Float32Arrays in the same order.
 */
export async function embedBatch(texts: string[], batchSize = 32): Promise<Float32Array[]> {
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    for (const text of batch) {
      const embedding = await embedText(text);
      results.push(embedding);
    }
  }

  return results;
}

/**
 * Dispose the pipeline and free memory.
 */
export async function disposeEmbedder(): Promise<void> {
  if (_pipeline && typeof _pipeline.dispose === 'function') {
    await _pipeline.dispose();
  }
  _pipeline = null;
  _currentModel = null;
}

/**
 * Check if the embedder is initialized.
 */
export function isEmbedderReady(): boolean {
  return _pipeline !== null;
}
