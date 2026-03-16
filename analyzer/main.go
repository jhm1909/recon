// Package main provides a Go AST extractor for CodeMap.
//
// It accepts Go file paths as arguments, parses them using go/ast,
// and outputs structured JSON to stdout containing functions, methods,
// structs, interfaces, and call expressions.
//
// Usage:
//
//	analyzer file1.go file2.go ...
//	analyzer -pkg internal/auth file1.go file2.go ...
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

func main() {
	pkg := flag.String("pkg", "", "Package relative path (e.g., internal/auth)")
	flag.Parse()

	files := flag.Args()
	if len(files) == 0 {
		fmt.Fprintln(os.Stderr, "Usage: analyzer [-pkg path] file1.go file2.go ...")
		os.Exit(1)
	}

	result := ExtractFiles(files, *pkg)

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(result); err != nil {
		fmt.Fprintf(os.Stderr, "Error encoding JSON: %v\n", err)
		os.Exit(1)
	}
}
