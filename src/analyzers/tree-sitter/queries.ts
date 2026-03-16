/**
 * Tree-sitter Query Definitions
 *
 * S-expression queries for extracting definitions, calls, and imports
 * from Python, Rust, Java, C, and C++ source files.
 *
 * Capture conventions:
 *   @name                 — symbol name
 *   @definition.{type}    — definition node (function, class, struct, etc.)
 *   @call.name / @call    — function/method call
 *   @import.source / @import — import statement
 *   @heritage.class       — inheriting type name
 *   @heritage.extends     — parent type name
 *   @heritage.implements  — implemented interface/trait
 *   @heritage.trait        — trait being implemented (Rust)
 */

import { Language } from '../../graph/types.js';

// ─── Python ─────────────────────────────────────────────────────

export const PYTHON_QUERIES = `
(class_definition
  name: (identifier) @name) @definition.class

(function_definition
  name: (identifier) @name) @definition.function

(import_statement
  name: (dotted_name) @import.source) @import

(import_from_statement
  module_name: (dotted_name) @import.source) @import

(import_from_statement
  module_name: (relative_import) @import.source) @import

(call
  function: (identifier) @call.name) @call

(call
  function: (attribute
    attribute: (identifier) @call.name)) @call

(class_definition
  name: (identifier) @heritage.class
  superclasses: (argument_list
    (identifier) @heritage.extends)) @heritage
`;

// ─── Rust ───────────────────────────────────────────────────────

export const RUST_QUERIES = `
(function_item name: (identifier) @name) @definition.function
(struct_item name: (type_identifier) @name) @definition.struct
(enum_item name: (type_identifier) @name) @definition.enum
(trait_item name: (type_identifier) @name) @definition.trait
(impl_item type: (type_identifier) @name !trait) @definition.impl
(impl_item type: (generic_type type: (type_identifier) @name) !trait) @definition.impl
(mod_item name: (identifier) @name) @definition.module
(type_item name: (type_identifier) @name) @definition.type
(const_item name: (identifier) @name) @definition.const
(static_item name: (identifier) @name) @definition.static
(macro_definition name: (identifier) @name) @definition.macro

(use_declaration argument: (_) @import.source) @import

(call_expression function: (identifier) @call.name) @call
(call_expression function: (field_expression field: (field_identifier) @call.name)) @call
(call_expression function: (scoped_identifier name: (identifier) @call.name)) @call

(struct_expression name: (type_identifier) @call.name) @call

(impl_item trait: (type_identifier) @heritage.trait type: (type_identifier) @heritage.class) @heritage
(impl_item trait: (generic_type type: (type_identifier) @heritage.trait) type: (type_identifier) @heritage.class) @heritage
(impl_item trait: (type_identifier) @heritage.trait type: (generic_type type: (type_identifier) @heritage.class)) @heritage
(impl_item trait: (generic_type type: (type_identifier) @heritage.trait) type: (generic_type type: (type_identifier) @heritage.class)) @heritage
`;

// ─── Java ───────────────────────────────────────────────────────

export const JAVA_QUERIES = `
(class_declaration name: (identifier) @name) @definition.class
(interface_declaration name: (identifier) @name) @definition.interface
(enum_declaration name: (identifier) @name) @definition.enum

(method_declaration name: (identifier) @name) @definition.method
(constructor_declaration name: (identifier) @name) @definition.constructor

(import_declaration (_) @import.source) @import

(method_invocation name: (identifier) @call.name) @call
(method_invocation object: (_) name: (identifier) @call.name) @call
(object_creation_expression type: (type_identifier) @call.name) @call

(class_declaration name: (identifier) @heritage.class
  (superclass (type_identifier) @heritage.extends)) @heritage

(class_declaration name: (identifier) @heritage.class
  (super_interfaces (type_list (type_identifier) @heritage.implements))) @heritage.impl
`;

// ─── C ──────────────────────────────────────────────────────────

export const C_QUERIES = `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @definition.function
(declaration declarator: (function_declarator declarator: (identifier) @name)) @definition.function

(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @definition.function

(struct_specifier name: (type_identifier) @name) @definition.struct
(union_specifier name: (type_identifier) @name) @definition.union
(enum_specifier name: (type_identifier) @name) @definition.enum
(type_definition declarator: (type_identifier) @name) @definition.typedef

(preproc_function_def name: (identifier) @name) @definition.macro
(preproc_def name: (identifier) @name) @definition.macro

(preproc_include path: (_) @import.source) @import

(call_expression function: (identifier) @call.name) @call
(call_expression function: (field_expression field: (field_identifier) @call.name)) @call
`;

// ─── C++ ────────────────────────────────────────────────────────

export const CPP_QUERIES = `
(class_specifier name: (type_identifier) @name) @definition.class
(struct_specifier name: (type_identifier) @name) @definition.struct
(namespace_definition name: (namespace_identifier) @name) @definition.namespace
(enum_specifier name: (type_identifier) @name) @definition.enum

(type_definition declarator: (type_identifier) @name) @definition.typedef
(union_specifier name: (type_identifier) @name) @definition.union

(preproc_function_def name: (identifier) @name) @definition.macro
(preproc_def name: (identifier) @name) @definition.macro

(function_definition declarator: (function_declarator declarator: (identifier) @name)) @definition.function
(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @name))) @definition.method
(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @definition.function

(declaration declarator: (function_declarator declarator: (identifier) @name)) @definition.function

(preproc_include path: (_) @import.source) @import

(call_expression function: (identifier) @call.name) @call
(call_expression function: (field_expression field: (field_identifier) @call.name)) @call
(call_expression function: (qualified_identifier name: (identifier) @call.name)) @call

(new_expression type: (type_identifier) @call.name) @call

(class_specifier name: (type_identifier) @heritage.class
  (base_class_clause (type_identifier) @heritage.extends)) @heritage
(class_specifier name: (type_identifier) @heritage.class
  (base_class_clause (access_specifier) (type_identifier) @heritage.extends)) @heritage
`;

// ─── Ruby ───────────────────────────────────────────────────────

export const RUBY_QUERIES = `
(class name: (constant) @name) @definition.class
(module name: (constant) @name) @definition.module
(method name: (identifier) @name) @definition.function
(singleton_method name: (identifier) @name) @definition.function

(call method: (identifier) @import.source) @import

(call method: (identifier) @call.name) @call

(class name: (constant) @heritage.class
  superclass: (superclass (constant) @heritage.extends)) @heritage
`;

// ─── PHP ────────────────────────────────────────────────────────

export const PHP_QUERIES = `
(class_declaration name: (name) @name) @definition.class
(interface_declaration name: (name) @name) @definition.interface
(trait_declaration name: (name) @name) @definition.trait
(enum_declaration name: (name) @name) @definition.enum

(function_definition name: (name) @name) @definition.function
(method_declaration name: (name) @name) @definition.method

(namespace_use_declaration (namespace_use_clause (qualified_name) @import.source)) @import

(function_call_expression function: (name) @call.name) @call
(function_call_expression function: (qualified_name) @call.name) @call
(member_call_expression name: (name) @call.name) @call
(scoped_call_expression name: (name) @call.name) @call
(object_creation_expression (qualified_name) @call.name) @call

(class_declaration name: (name) @heritage.class
  (base_clause (name) @heritage.extends)) @heritage

(class_declaration name: (name) @heritage.class
  (class_interface_clause (name) @heritage.implements)) @heritage.impl
`;

// ─── C# ─────────────────────────────────────────────────────────

export const CSHARP_QUERIES = `
(class_declaration name: (identifier) @name) @definition.class
(interface_declaration name: (identifier) @name) @definition.interface
(struct_declaration name: (identifier) @name) @definition.struct
(enum_declaration name: (identifier) @name) @definition.enum

(method_declaration name: (identifier) @name) @definition.method
(constructor_declaration name: (identifier) @name) @definition.constructor

(using_directive (qualified_name) @import.source) @import
(using_directive (identifier) @import.source) @import

(invocation_expression function: (identifier) @call.name) @call
(invocation_expression function: (member_access_expression name: (identifier) @call.name)) @call
(object_creation_expression type: (identifier) @call.name) @call

(class_declaration name: (identifier) @heritage.class
  (base_list (identifier) @heritage.extends)) @heritage
`;

// ─── Kotlin ─────────────────────────────────────────────────────

export const KOTLIN_QUERIES = `
(class_declaration (type_identifier) @name) @definition.class
(object_declaration (type_identifier) @name) @definition.class
(interface_declaration (type_identifier) @name) @definition.interface

(function_declaration (simple_identifier) @name) @definition.function

(import_header (identifier) @import.source) @import

(call_expression (simple_identifier) @call.name) @call
(call_expression (navigation_expression (simple_identifier) @call.name)) @call

(class_declaration (type_identifier) @heritage.class
  (delegation_specifier_list (delegation_specifier (user_type (type_identifier) @heritage.extends)))) @heritage
`;

// ─── Swift ──────────────────────────────────────────────────────

export const SWIFT_QUERIES = `
(class_declaration name: (type_identifier) @name) @definition.class
(protocol_declaration name: (type_identifier) @name) @definition.interface
(struct_declaration name: (type_identifier) @name) @definition.struct
(enum_declaration name: (type_identifier) @name) @definition.enum

(function_declaration name: (simple_identifier) @name) @definition.function

(import_declaration (identifier) @import.source) @import

(call_expression (simple_identifier) @call.name) @call
(call_expression (navigation_expression (simple_identifier) @call.name)) @call

(class_declaration name: (type_identifier) @heritage.class
  (inheritance_specifier (type_identifier) @heritage.extends)) @heritage
`;

// ─── Query Map ──────────────────────────────────────────────────

export const LANGUAGE_QUERIES: Partial<Record<Language, string>> = {
  [Language.Python]: PYTHON_QUERIES,
  [Language.Rust]: RUST_QUERIES,
  [Language.Java]: JAVA_QUERIES,
  [Language.C]: C_QUERIES,
  [Language.Cpp]: CPP_QUERIES,
  [Language.Ruby]: RUBY_QUERIES,
  [Language.PHP]: PHP_QUERIES,
  [Language.CSharp]: CSHARP_QUERIES,
  [Language.Kotlin]: KOTLIN_QUERIES,
  [Language.Swift]: SWIFT_QUERIES,
};
