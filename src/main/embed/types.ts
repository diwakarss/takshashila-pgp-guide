// The embedder seam. Kept import-free so anything (importer, tests, the main
// proxy) can depend on the interface without pulling in the model runtime.
export interface Embedder {
  /** Embed corpus/document text (applies the document prefix). */
  embedDocuments(texts: string[]): Promise<number[][]>
  /** Embed a search query (applies the query prefix). */
  embedQuery(text: string): Promise<number[]>
  /** Preload the model so the first real call isn't a cold start (eng D10). */
  warmup(): Promise<void>
}
