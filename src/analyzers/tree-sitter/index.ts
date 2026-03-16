export { analyzeTreeSitter } from './analyzer.js';
export type { TreeSitterAnalysisResult } from './analyzer.js';
export { getLanguageForFile, isLanguageAvailable, getAvailableLanguages } from './parser.js';
export { extractFromFile, buildGraphFromExtractions } from './extractor.js';
export type { ExtractedSymbol, ExtractedCall, ExtractedImport, ExtractedHeritage, FileExtractionResult } from './extractor.js';
export { LANGUAGE_QUERIES } from './queries.js';
