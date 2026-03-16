/**
 * Tree-sitter Parser Loader
 *
 * Manages tree-sitter parser instances and language grammars.
 * Dynamically loads language grammars so missing packages are non-fatal.
 */

import Parser from 'tree-sitter';
import { createRequire } from 'node:module';
import { Language } from '../../graph/types.js';

const _require = createRequire(import.meta.url);

let parser: Parser | null = null;

const languageModules: Partial<Record<Language, any>> = {};
let languagesLoaded = false;

/**
 * File extension → Language mapping for tree-sitter supported languages.
 */
const EXTENSION_MAP: Record<string, Language> = {
  '.py': Language.Python,
  '.pyw': Language.Python,
  '.rs': Language.Rust,
  '.java': Language.Java,
  '.c': Language.C,
  '.h': Language.C,
  '.cpp': Language.Cpp,
  '.cc': Language.Cpp,
  '.cxx': Language.Cpp,
  '.hpp': Language.Cpp,
  '.hxx': Language.Cpp,
  '.hh': Language.Cpp,
};

/**
 * Get the tree-sitter language for a file extension.
 * Returns undefined for unsupported extensions.
 */
export function getLanguageForFile(filePath: string): Language | undefined {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return EXTENSION_MAP[ext];
}

/**
 * Load all available language grammars.
 * Missing packages are silently skipped.
 */
function loadLanguages(): void {
  if (languagesLoaded) return;
  languagesLoaded = true;

  const loaders: [Language, () => any][] = [
    [Language.Python, () => _require('tree-sitter-python')],
    [Language.Rust, () => _require('tree-sitter-rust')],
    [Language.Java, () => _require('tree-sitter-java')],
    [Language.C, () => _require('tree-sitter-c')],
    [Language.Cpp, () => _require('tree-sitter-cpp')],
  ];

  for (const [lang, loader] of loaders) {
    try {
      languageModules[lang] = loader();
    } catch {
      // Package not installed — skip
    }
  }
}

/**
 * Check if a language grammar is available.
 */
export function isLanguageAvailable(language: Language): boolean {
  loadLanguages();
  return language in languageModules;
}

/**
 * Get or create the singleton parser.
 */
export function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
  }
  return parser;
}

/**
 * Set the parser's language and return it ready for parsing.
 * Throws if the language grammar is not available.
 */
export function setParserLanguage(language: Language): Parser {
  loadLanguages();
  const grammar = languageModules[language];
  if (!grammar) {
    throw new Error(`Tree-sitter grammar not available for ${language}`);
  }
  const p = getParser();
  p.setLanguage(grammar);
  return p;
}

/**
 * Get all file extensions supported by tree-sitter.
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(EXTENSION_MAP);
}

/**
 * Get all languages that have grammars installed.
 */
export function getAvailableLanguages(): Language[] {
  loadLanguages();
  return Object.keys(languageModules) as Language[];
}
