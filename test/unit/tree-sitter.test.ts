/**
 * Unit Tests: Tree-sitter Multi-Language Support
 *
 * Tests the tree-sitter analyzer: parser loading, query-based extraction,
 * graph construction, and language-specific features.
 */
import { describe, it, expect } from 'vitest';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import {
  getLanguageForFile,
  isLanguageAvailable,
  getAvailableLanguages,
  extractFromFile,
  buildGraphFromExtractions,
  LANGUAGE_QUERIES,
} from '../../src/analyzers/tree-sitter/index.js';
import type { FileExtractionResult } from '../../src/analyzers/tree-sitter/index.js';

// ─── Language Detection ─────────────────────────────────────────

describe('getLanguageForFile', () => {
  it('detects Python files', () => {
    expect(getLanguageForFile('main.py')).toBe(Language.Python);
    expect(getLanguageForFile('script.pyw')).toBe(Language.Python);
  });

  it('detects Rust files', () => {
    expect(getLanguageForFile('lib.rs')).toBe(Language.Rust);
  });

  it('detects Java files', () => {
    expect(getLanguageForFile('Main.java')).toBe(Language.Java);
  });

  it('detects C files', () => {
    expect(getLanguageForFile('main.c')).toBe(Language.C);
    expect(getLanguageForFile('header.h')).toBe(Language.C);
  });

  it('detects C++ files', () => {
    expect(getLanguageForFile('main.cpp')).toBe(Language.Cpp);
    expect(getLanguageForFile('class.cc')).toBe(Language.Cpp);
    expect(getLanguageForFile('header.hpp')).toBe(Language.Cpp);
    expect(getLanguageForFile('other.cxx')).toBe(Language.Cpp);
    expect(getLanguageForFile('h.hxx')).toBe(Language.Cpp);
    expect(getLanguageForFile('x.hh')).toBe(Language.Cpp);
  });

  it('returns undefined for unsupported extensions', () => {
    expect(getLanguageForFile('file.go')).toBeUndefined();
    expect(getLanguageForFile('file.ts')).toBeUndefined();
    expect(getLanguageForFile('file.txt')).toBeUndefined();
    expect(getLanguageForFile('Makefile')).toBeUndefined();
  });
});

// ─── Query Definitions ──────────────────────────────────────────

describe('LANGUAGE_QUERIES', () => {
  it('has queries for all tree-sitter languages', () => {
    expect(LANGUAGE_QUERIES[Language.Python]).toBeDefined();
    expect(LANGUAGE_QUERIES[Language.Rust]).toBeDefined();
    expect(LANGUAGE_QUERIES[Language.Java]).toBeDefined();
    expect(LANGUAGE_QUERIES[Language.C]).toBeDefined();
    expect(LANGUAGE_QUERIES[Language.Cpp]).toBeDefined();
  });

  it('does not have queries for Go or TypeScript (handled by dedicated analyzers)', () => {
    expect(LANGUAGE_QUERIES[Language.Go]).toBeUndefined();
    expect(LANGUAGE_QUERIES[Language.TypeScript]).toBeUndefined();
  });

  it('queries contain definition patterns', () => {
    for (const lang of [Language.Python, Language.Rust, Language.C, Language.Cpp]) {
      const q = LANGUAGE_QUERIES[lang]!;
      expect(q).toContain('@definition.function');
      expect(q).toContain('@name');
    }
    // Java has methods instead of standalone functions
    expect(LANGUAGE_QUERIES[Language.Java]).toContain('@definition.method');
    expect(LANGUAGE_QUERIES[Language.Java]).toContain('@definition.class');
  });

  it('queries contain call patterns', () => {
    for (const lang of [Language.Python, Language.Rust, Language.Java, Language.C, Language.Cpp]) {
      const q = LANGUAGE_QUERIES[lang]!;
      expect(q).toContain('@call.name');
    }
  });

  it('queries contain import patterns', () => {
    for (const lang of [Language.Python, Language.Rust, Language.Java, Language.C, Language.Cpp]) {
      const q = LANGUAGE_QUERIES[lang]!;
      expect(q).toContain('@import');
    }
  });
});

// ─── Parser Availability ────────────────────────────────────────

describe('parser availability', () => {
  it('has at least one language available', () => {
    const langs = getAvailableLanguages();
    expect(langs.length).toBeGreaterThan(0);
  });

  it('reports Python as available', () => {
    expect(isLanguageAvailable(Language.Python)).toBe(true);
  });

  it('reports Rust as available', () => {
    expect(isLanguageAvailable(Language.Rust)).toBe(true);
  });

  it('reports Java as available', () => {
    expect(isLanguageAvailable(Language.Java)).toBe(true);
  });

  it('reports C as available', () => {
    expect(isLanguageAvailable(Language.C)).toBe(true);
  });

  it('reports C++ as available', () => {
    expect(isLanguageAvailable(Language.Cpp)).toBe(true);
  });

  it('does not report Go as tree-sitter available (uses dedicated analyzer)', () => {
    expect(isLanguageAvailable(Language.Go)).toBe(false);
  });
});

// ─── Python Extraction ──────────────────────────────────────────

describe('extractFromFile: Python', () => {
  const PYTHON_CODE = `
import os
from pathlib import Path

class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        pass

class Dog(Animal):
    def speak(self):
        return "Woof"

def create_dog(name):
    return Dog(name)

def _private_helper():
    pass
`;

  it('extracts class definitions', () => {
    const result = extractFromFile('animals.py', PYTHON_CODE, Language.Python);
    const classes = result.symbols.filter(s => s.type === NodeType.Class);
    expect(classes.length).toBe(2);
    expect(classes.map(c => c.name)).toContain('Animal');
    expect(classes.map(c => c.name)).toContain('Dog');
  });

  it('extracts function definitions', () => {
    const result = extractFromFile('animals.py', PYTHON_CODE, Language.Python);
    const funcs = result.symbols.filter(s => s.type === NodeType.Function);
    const names = funcs.map(f => f.name);
    expect(names).toContain('create_dog');
    expect(names).toContain('_private_helper');
    // Methods inside classes are also captured as functions in Python
    expect(names).toContain('__init__');
    expect(names).toContain('speak');
  });

  it('detects Python export conventions', () => {
    const result = extractFromFile('animals.py', PYTHON_CODE, Language.Python);
    const priv = result.symbols.find(s => s.name === '_private_helper');
    expect(priv?.exported).toBe(false);

    const pub = result.symbols.find(s => s.name === 'create_dog');
    expect(pub?.exported).toBe(true);
  });

  it('extracts imports', () => {
    const result = extractFromFile('animals.py', PYTHON_CODE, Language.Python);
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
    const sources = result.imports.map(i => i.source);
    expect(sources).toContain('os');
    expect(sources).toContain('pathlib');
  });

  it('extracts calls', () => {
    const result = extractFromFile('animals.py', PYTHON_CODE, Language.Python);
    const callNames = result.calls.map(c => c.calleeName);
    expect(callNames).toContain('Dog');
  });

  it('extracts class inheritance', () => {
    const result = extractFromFile('animals.py', PYTHON_CODE, Language.Python);
    expect(result.heritage.length).toBe(1);
    expect(result.heritage[0].childName).toBe('Dog');
    expect(result.heritage[0].parentName).toBe('Animal');
    expect(result.heritage[0].kind).toBe('extends');
  });

  it('sets correct file and language', () => {
    const result = extractFromFile('src/models/animals.py', PYTHON_CODE, Language.Python);
    for (const sym of result.symbols) {
      expect(sym.file).toBe('src/models/animals.py');
      expect(sym.language).toBe(Language.Python);
      expect(sym.package).toBe('src/models');
    }
  });

  it('generates unique IDs with py: prefix', () => {
    const result = extractFromFile('animals.py', PYTHON_CODE, Language.Python);
    const ids = result.symbols.map(s => s.id);
    for (const id of ids) {
      expect(id).toMatch(/^py:/);
    }
    // All unique
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Rust Extraction ────────────────────────────────────────────

describe('extractFromFile: Rust', () => {
  const RUST_CODE = `
use std::collections::HashMap;

pub struct Config {
    pub name: String,
    value: i32,
}

pub enum Status {
    Active,
    Inactive,
}

pub trait Validate {
    fn validate(&self) -> bool;
}

impl Validate for Config {
    fn validate(&self) -> bool {
        !self.name.is_empty()
    }
}

pub fn create_config(name: &str) -> Config {
    Config { name: name.to_string(), value: 0 }
}
`;

  it('extracts struct definitions', () => {
    const result = extractFromFile('config.rs', RUST_CODE, Language.Rust);
    const structs = result.symbols.filter(s => s.type === NodeType.Struct);
    expect(structs.map(s => s.name)).toContain('Config');
  });

  it('extracts enum definitions', () => {
    const result = extractFromFile('config.rs', RUST_CODE, Language.Rust);
    const enums = result.symbols.filter(s => s.type === NodeType.Enum);
    expect(enums.map(s => s.name)).toContain('Status');
  });

  it('extracts trait definitions', () => {
    const result = extractFromFile('config.rs', RUST_CODE, Language.Rust);
    const traits = result.symbols.filter(s => s.type === NodeType.Trait);
    expect(traits.map(s => s.name)).toContain('Validate');
  });

  it('extracts function definitions', () => {
    const result = extractFromFile('config.rs', RUST_CODE, Language.Rust);
    const funcs = result.symbols.filter(s => s.type === NodeType.Function);
    expect(funcs.map(s => s.name)).toContain('create_config');
  });

  it('extracts use imports', () => {
    const result = extractFromFile('config.rs', RUST_CODE, Language.Rust);
    expect(result.imports.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts trait implementation heritage', () => {
    const result = extractFromFile('config.rs', RUST_CODE, Language.Rust);
    const implHeritage = result.heritage.filter(h => h.kind === 'trait');
    expect(implHeritage.length).toBe(1);
    expect(implHeritage[0].childName).toBe('Config');
    expect(implHeritage[0].parentName).toBe('Validate');
  });

  it('generates rs: prefixed IDs', () => {
    const result = extractFromFile('config.rs', RUST_CODE, Language.Rust);
    for (const sym of result.symbols) {
      expect(sym.id).toMatch(/^rs:/);
    }
  });
});

// ─── Java Extraction ────────────────────────────────────────────

describe('extractFromFile: Java', () => {
  const JAVA_CODE = `
import java.util.List;
import java.util.ArrayList;

public class UserService {
    private List<User> users = new ArrayList<>();

    public User findById(int id) {
        return users.get(id);
    }

    public void addUser(User user) {
        users.add(user);
    }
}

interface Repository {
    void save(Object entity);
}

enum Role {
    ADMIN,
    USER,
    GUEST
}
`;

  it('extracts class definitions', () => {
    const result = extractFromFile('UserService.java', JAVA_CODE, Language.Java);
    const classes = result.symbols.filter(s => s.type === NodeType.Class);
    expect(classes.map(s => s.name)).toContain('UserService');
  });

  it('extracts interface definitions', () => {
    const result = extractFromFile('UserService.java', JAVA_CODE, Language.Java);
    const ifaces = result.symbols.filter(s => s.type === NodeType.Interface);
    expect(ifaces.map(s => s.name)).toContain('Repository');
  });

  it('extracts enum definitions', () => {
    const result = extractFromFile('UserService.java', JAVA_CODE, Language.Java);
    const enums = result.symbols.filter(s => s.type === NodeType.Enum);
    expect(enums.map(s => s.name)).toContain('Role');
  });

  it('extracts method definitions', () => {
    const result = extractFromFile('UserService.java', JAVA_CODE, Language.Java);
    const methods = result.symbols.filter(s => s.type === NodeType.Method);
    const names = methods.map(s => s.name);
    expect(names).toContain('findById');
    expect(names).toContain('addUser');
  });

  it('extracts imports', () => {
    const result = extractFromFile('UserService.java', JAVA_CODE, Language.Java);
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });

  it('generates java: prefixed IDs', () => {
    const result = extractFromFile('UserService.java', JAVA_CODE, Language.Java);
    for (const sym of result.symbols) {
      expect(sym.id).toMatch(/^java:/);
    }
  });
});

// ─── C Extraction ───────────────────────────────────────────────

describe('extractFromFile: C', () => {
  const C_CODE = `
#include <stdio.h>
#include "utils.h"

struct Point {
    int x;
    int y;
};

enum Color { RED, GREEN, BLUE };

void print_point(struct Point p) {
    printf("(%d, %d)", p.x, p.y);
}

int add(int a, int b) {
    return a + b;
}

#define MAX_SIZE 100
`;

  it('extracts function definitions', () => {
    const result = extractFromFile('main.c', C_CODE, Language.C);
    const funcs = result.symbols.filter(s => s.type === NodeType.Function);
    const names = funcs.map(s => s.name);
    expect(names).toContain('print_point');
    expect(names).toContain('add');
  });

  it('extracts struct definitions', () => {
    const result = extractFromFile('main.c', C_CODE, Language.C);
    const structs = result.symbols.filter(s => s.type === NodeType.Struct);
    expect(structs.map(s => s.name)).toContain('Point');
  });

  it('extracts enum definitions', () => {
    const result = extractFromFile('main.c', C_CODE, Language.C);
    const enums = result.symbols.filter(s => s.type === NodeType.Enum);
    expect(enums.map(s => s.name)).toContain('Color');
  });

  it('extracts includes as imports', () => {
    const result = extractFromFile('main.c', C_CODE, Language.C);
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts macro definitions', () => {
    const result = extractFromFile('main.c', C_CODE, Language.C);
    const macros = result.symbols.filter(s => s.name === 'MAX_SIZE');
    expect(macros.length).toBe(1);
  });

  it('extracts calls', () => {
    const result = extractFromFile('main.c', C_CODE, Language.C);
    const callNames = result.calls.map(c => c.calleeName);
    expect(callNames).toContain('printf');
  });

  it('generates c: prefixed IDs', () => {
    const result = extractFromFile('main.c', C_CODE, Language.C);
    for (const sym of result.symbols) {
      expect(sym.id).toMatch(/^c:/);
    }
  });
});

// ─── C++ Extraction ─────────────────────────────────────────────

describe('extractFromFile: C++', () => {
  const CPP_CODE = `
#include <iostream>
#include <vector>

namespace shapes {

class Shape {
public:
    virtual double area() = 0;
};

class Circle : public Shape {
public:
    Circle(double r) : radius(r) {}
    double area() { return 3.14 * radius * radius; }
private:
    double radius;
};

enum class Color { Red, Green, Blue };

}

void print_area(shapes::Shape& s) {
    std::cout << s.area() << std::endl;
}
`;

  it('extracts class definitions', () => {
    const result = extractFromFile('shapes.cpp', CPP_CODE, Language.Cpp);
    const classes = result.symbols.filter(s => s.type === NodeType.Class);
    const names = classes.map(s => s.name);
    expect(names).toContain('Shape');
    expect(names).toContain('Circle');
  });

  it('extracts namespace as Package', () => {
    const result = extractFromFile('shapes.cpp', CPP_CODE, Language.Cpp);
    const pkgs = result.symbols.filter(s => s.type === NodeType.Package);
    expect(pkgs.map(s => s.name)).toContain('shapes');
  });

  it('extracts enum definitions', () => {
    const result = extractFromFile('shapes.cpp', CPP_CODE, Language.Cpp);
    const enums = result.symbols.filter(s => s.type === NodeType.Enum);
    expect(enums.map(s => s.name)).toContain('Color');
  });

  it('extracts function definitions', () => {
    const result = extractFromFile('shapes.cpp', CPP_CODE, Language.Cpp);
    const funcs = result.symbols.filter(s => s.type === NodeType.Function);
    expect(funcs.map(s => s.name)).toContain('print_area');
  });

  it('extracts class inheritance', () => {
    const result = extractFromFile('shapes.cpp', CPP_CODE, Language.Cpp);
    const ext = result.heritage.filter(h => h.kind === 'extends');
    expect(ext.length).toBe(1);
    expect(ext[0].childName).toBe('Circle');
    expect(ext[0].parentName).toBe('Shape');
  });

  it('generates cpp: prefixed IDs', () => {
    const result = extractFromFile('shapes.cpp', CPP_CODE, Language.Cpp);
    for (const sym of result.symbols) {
      expect(sym.id).toMatch(/^cpp:/);
    }
  });
});

// ─── Graph Construction ─────────────────────────────────────────

describe('buildGraphFromExtractions', () => {
  function makePythonExtraction(): Map<string, FileExtractionResult> {
    const map = new Map<string, FileExtractionResult>();

    map.set('models.py', extractFromFile('models.py', `
class Animal:
    def speak(self):
        pass

class Dog(Animal):
    def speak(self):
        return "Woof"
`, Language.Python));

    map.set('main.py', extractFromFile('main.py', `
from models import Dog

def main():
    dog = Dog("Rex")
    dog.speak()
`, Language.Python));

    return map;
  }

  it('creates nodes from symbols', () => {
    const extractions = makePythonExtraction();
    const result = buildGraphFromExtractions(extractions);
    expect(result.nodes.length).toBeGreaterThan(0);
    const names = result.nodes.map(n => n.name);
    expect(names).toContain('Animal');
    expect(names).toContain('Dog');
    expect(names).toContain('main');
  });

  it('creates CALLS relationships', () => {
    const extractions = makePythonExtraction();
    const result = buildGraphFromExtractions(extractions);
    const calls = result.relationships.filter(r => r.type === RelationshipType.CALLS);
    // main() calls Dog()
    const dogCall = calls.find(c => {
      const target = result.nodes.find(n => n.id === c.targetId);
      return target?.name === 'Dog';
    });
    expect(dogCall).toBeDefined();
  });

  it('creates EXTENDS relationships from heritage', () => {
    const extractions = makePythonExtraction();
    const result = buildGraphFromExtractions(extractions);
    const extends_ = result.relationships.filter(r => r.type === RelationshipType.EXTENDS);
    expect(extends_.length).toBe(1);

    const child = result.nodes.find(n => n.id === extends_[0].sourceId);
    const parent = result.nodes.find(n => n.id === extends_[0].targetId);
    expect(child?.name).toBe('Dog');
    expect(parent?.name).toBe('Animal');
  });

  it('sets correct confidence levels', () => {
    const extractions = makePythonExtraction();
    const result = buildGraphFromExtractions(extractions);

    const calls = result.relationships.filter(r => r.type === RelationshipType.CALLS);
    for (const call of calls) {
      expect(call.confidence).toBe(0.7);
    }

    const extends_ = result.relationships.filter(r => r.type === RelationshipType.EXTENDS);
    for (const ext of extends_) {
      expect(ext.confidence).toBe(0.9);
    }
  });

  it('handles empty extractions', () => {
    const empty = new Map<string, FileExtractionResult>();
    const result = buildGraphFromExtractions(empty);
    expect(result.nodes).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });
});

// ─── Cross-Language Consistency ─────────────────────────────────

describe('cross-language consistency', () => {
  it('all extracted symbols have required Node fields', () => {
    const samples: [string, string, Language][] = [
      ['test.py', 'def hello(): pass', Language.Python],
      ['test.rs', 'fn hello() {}', Language.Rust],
      ['test.java', 'class Hello { void greet() {} }', Language.Java],
      ['test.c', 'void hello() {}', Language.C],
      ['test.cpp', 'void hello() {}', Language.Cpp],
    ];

    for (const [file, code, lang] of samples) {
      const result = extractFromFile(file, code, lang);
      expect(result.symbols.length).toBeGreaterThan(0);
      for (const sym of result.symbols) {
        expect(sym.id).toBeTruthy();
        expect(sym.name).toBeTruthy();
        expect(sym.type).toBeTruthy();
        expect(sym.file).toBe(file);
        expect(sym.startLine).toBeGreaterThan(0);
        expect(sym.language).toBe(lang);
      }
    }
  });
});
