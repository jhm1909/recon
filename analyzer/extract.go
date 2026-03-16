package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"unicode"
)

// ─── Output types ─────────────────────────────────────────────

// ExtractResult is the top-level JSON output.
type ExtractResult struct {
	Files []FileResult `json:"files"`
}

// FileResult contains all symbols extracted from a single Go file.
type FileResult struct {
	Path       string      `json:"path"`
	Functions  []FuncInfo  `json:"functions"`
	Methods    []FuncInfo  `json:"methods"`
	Structs    []TypeInfo  `json:"structs"`
	Interfaces []TypeInfo  `json:"interfaces"`
	Calls      []CallInfo  `json:"calls"`
}

// FuncInfo describes a function or method declaration.
type FuncInfo struct {
	Name       string   `json:"name"`
	Receiver   string   `json:"receiver,omitempty"`
	Params     []string `json:"params"`
	Returns    string   `json:"returns"`
	StartLine  int      `json:"startLine"`
	EndLine    int      `json:"endLine"`
	Exported   bool     `json:"exported"`
}

// TypeInfo describes a struct or interface declaration.
type TypeInfo struct {
	Name       string   `json:"name"`
	StartLine  int      `json:"startLine"`
	EndLine    int      `json:"endLine"`
	Exported   bool     `json:"exported"`
	Fields     []string `json:"fields,omitempty"`     // Struct fields
	Embeds     []string `json:"embeds,omitempty"`     // Struct embedded types
	Methods    []string `json:"methods,omitempty"`    // Interface method signatures
}

// CallInfo describes a function/method call expression.
type CallInfo struct {
	CallerFunc string `json:"callerFunc"`           // Enclosing function name
	CallerRecv string `json:"callerRecv,omitempty"` // Enclosing method receiver
	Callee     string `json:"callee"`               // Called function name
	Qualifier  string `json:"qualifier,omitempty"`   // Package or receiver prefix
	Line       int    `json:"line"`
}

// ─── Extraction ───────────────────────────────────────────────

// ExtractFiles parses multiple Go files and returns combined results.
func ExtractFiles(paths []string, pkgPath string) ExtractResult {
	result := ExtractResult{
		Files: make([]FileResult, 0, len(paths)),
	}

	for _, path := range paths {
		fr, err := extractFile(path, pkgPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: skipping %s: %v\n", path, err)
			continue
		}
		result.Files = append(result.Files, fr)
	}

	return result
}

func extractFile(path string, pkgPath string) (FileResult, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, nil, parser.AllErrors)
	if err != nil {
		return FileResult{}, err
	}

	fr := FileResult{
		Path:       path,
		Functions:  []FuncInfo{},
		Methods:    []FuncInfo{},
		Structs:    []TypeInfo{},
		Interfaces: []TypeInfo{},
		Calls:      []CallInfo{},
	}

	// First pass: extract declarations
	for _, decl := range file.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			fi := extractFunc(fset, d)
			if d.Recv != nil {
				fr.Methods = append(fr.Methods, fi)
			} else {
				fr.Functions = append(fr.Functions, fi)
			}

			// Extract calls within this function
			if d.Body != nil {
				calls := extractCalls(fset, d)
				fr.Calls = append(fr.Calls, calls...)
			}

		case *ast.GenDecl:
			if d.Tok == token.TYPE {
				for _, spec := range d.Specs {
					ts, ok := spec.(*ast.TypeSpec)
					if !ok {
						continue
					}
					switch t := ts.Type.(type) {
					case *ast.StructType:
						fr.Structs = append(fr.Structs, extractStruct(fset, ts, t, d))
					case *ast.InterfaceType:
						fr.Interfaces = append(fr.Interfaces, extractInterface(fset, ts, t, d))
					}
				}
			}
		}
	}

	return fr, nil
}

// ─── Function/Method extraction ─────────────────────────────

func extractFunc(fset *token.FileSet, fn *ast.FuncDecl) FuncInfo {
	fi := FuncInfo{
		Name:      fn.Name.Name,
		Exported:  isExported(fn.Name.Name),
		StartLine: fset.Position(fn.Pos()).Line,
		EndLine:   fset.Position(fn.End()).Line,
		Params:    []string{},
		Returns:   "",
	}

	// Receiver
	if fn.Recv != nil && len(fn.Recv.List) > 0 {
		fi.Receiver = typeString(fn.Recv.List[0].Type)
	}

	// Parameters
	if fn.Type.Params != nil {
		for _, p := range fn.Type.Params.List {
			typStr := typeString(p.Type)
			if len(p.Names) == 0 {
				fi.Params = append(fi.Params, typStr)
			} else {
				for _, n := range p.Names {
					fi.Params = append(fi.Params, n.Name+" "+typStr)
				}
			}
		}
	}

	// Return type
	if fn.Type.Results != nil {
		parts := make([]string, 0, len(fn.Type.Results.List))
		for _, r := range fn.Type.Results.List {
			parts = append(parts, typeString(r.Type))
		}
		if len(parts) == 1 {
			fi.Returns = parts[0]
		} else if len(parts) > 1 {
			fi.Returns = "(" + strings.Join(parts, ", ") + ")"
		}
	}

	return fi
}

// ─── Struct extraction ──────────────────────────────────────

func extractStruct(fset *token.FileSet, ts *ast.TypeSpec, st *ast.StructType, gd *ast.GenDecl) TypeInfo {
	ti := TypeInfo{
		Name:      ts.Name.Name,
		Exported:  isExported(ts.Name.Name),
		StartLine: fset.Position(gd.Pos()).Line,
		EndLine:   fset.Position(gd.End()).Line,
		Fields:    []string{},
		Embeds:    []string{},
	}

	if st.Fields != nil {
		for _, f := range st.Fields.List {
			typStr := typeString(f.Type)
			if len(f.Names) == 0 {
				// Embedded type
				ti.Embeds = append(ti.Embeds, typStr)
			} else {
				for _, n := range f.Names {
					ti.Fields = append(ti.Fields, n.Name+" "+typStr)
				}
			}
		}
	}

	return ti
}

// ─── Interface extraction ───────────────────────────────────

func extractInterface(fset *token.FileSet, ts *ast.TypeSpec, it *ast.InterfaceType, gd *ast.GenDecl) TypeInfo {
	ti := TypeInfo{
		Name:      ts.Name.Name,
		Exported:  isExported(ts.Name.Name),
		StartLine: fset.Position(gd.Pos()).Line,
		EndLine:   fset.Position(gd.End()).Line,
		Methods:   []string{},
	}

	if it.Methods != nil {
		for _, m := range it.Methods.List {
			switch t := m.Type.(type) {
			case *ast.FuncType:
				if len(m.Names) > 0 {
					sig := m.Names[0].Name + funcTypeString(t)
					ti.Methods = append(ti.Methods, sig)
				}
			case *ast.Ident:
				// Embedded interface
				ti.Methods = append(ti.Methods, t.Name)
			case *ast.SelectorExpr:
				// Embedded interface from another package
				ti.Methods = append(ti.Methods, typeString(t))
			}
		}
	}

	return ti
}

// ─── Call expression extraction ─────────────────────────────

func extractCalls(fset *token.FileSet, fn *ast.FuncDecl) []CallInfo {
	var calls []CallInfo
	callerName := fn.Name.Name
	callerRecv := ""
	if fn.Recv != nil && len(fn.Recv.List) > 0 {
		callerRecv = typeString(fn.Recv.List[0].Type)
	}

	ast.Inspect(fn.Body, func(n ast.Node) bool {
		ce, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}

		ci := CallInfo{
			CallerFunc: callerName,
			CallerRecv: callerRecv,
			Line:       fset.Position(ce.Pos()).Line,
		}

		switch fun := ce.Fun.(type) {
		case *ast.Ident:
			// Direct call: funcName()
			ci.Callee = fun.Name
		case *ast.SelectorExpr:
			// Qualified call: pkg.Func() or recv.Method()
			ci.Callee = fun.Sel.Name
			switch x := fun.X.(type) {
			case *ast.Ident:
				ci.Qualifier = x.Name
			case *ast.CallExpr:
				// Chained call: something().Method() — use method name only
			case *ast.SelectorExpr:
				// Deep chain: a.b.Method()
				ci.Qualifier = typeString(fun.X)
			}
		default:
			// Type conversion, func literal call, etc. — skip
			return true
		}

		// Only record meaningful calls (skip builtins like len, make, etc.)
		if ci.Callee != "" && !isBuiltin(ci.Callee) {
			calls = append(calls, ci)
		}

		return true
	})

	return calls
}

// ─── Helpers ────────────────────────────────────────────────

func isExported(name string) bool {
	if name == "" {
		return false
	}
	return unicode.IsUpper([]rune(name)[0])
}

func isBuiltin(name string) bool {
	switch name {
	case "len", "cap", "make", "new", "append", "copy", "delete",
		"close", "panic", "recover", "print", "println",
		"complex", "real", "imag", "clear", "min", "max":
		return true
	}
	return false
}

// typeString converts an AST type expression to a readable string.
func typeString(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return "*" + typeString(t.X)
	case *ast.SelectorExpr:
		return typeString(t.X) + "." + t.Sel.Name
	case *ast.ArrayType:
		if t.Len == nil {
			return "[]" + typeString(t.Elt)
		}
		return "[...]" + typeString(t.Elt)
	case *ast.MapType:
		return "map[" + typeString(t.Key) + "]" + typeString(t.Value)
	case *ast.InterfaceType:
		return "interface{}"
	case *ast.FuncType:
		return "func" + funcTypeString(t)
	case *ast.ChanType:
		return "chan " + typeString(t.Value)
	case *ast.Ellipsis:
		return "..." + typeString(t.Elt)
	case *ast.IndexExpr:
		return typeString(t.X) + "[" + typeString(t.Index) + "]"
	case *ast.IndexListExpr:
		parts := make([]string, len(t.Indices))
		for i, idx := range t.Indices {
			parts[i] = typeString(idx)
		}
		return typeString(t.X) + "[" + strings.Join(parts, ", ") + "]"
	default:
		return "unknown"
	}
}

func funcTypeString(ft *ast.FuncType) string {
	var sb strings.Builder
	sb.WriteByte('(')
	if ft.Params != nil {
		for i, p := range ft.Params.List {
			if i > 0 {
				sb.WriteString(", ")
			}
			ts := typeString(p.Type)
			if len(p.Names) > 0 {
				for j, n := range p.Names {
					if j > 0 {
						sb.WriteString(", ")
					}
					sb.WriteString(n.Name)
				}
				sb.WriteByte(' ')
			}
			sb.WriteString(ts)
		}
	}
	sb.WriteByte(')')

	if ft.Results != nil && len(ft.Results.List) > 0 {
		sb.WriteByte(' ')
		if len(ft.Results.List) > 1 {
			sb.WriteByte('(')
		}
		for i, r := range ft.Results.List {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(typeString(r.Type))
		}
		if len(ft.Results.List) > 1 {
			sb.WriteByte(')')
		}
	}

	return sb.String()
}
