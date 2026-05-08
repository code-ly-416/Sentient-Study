"""
Extract Codebase - Creates a structured text file of the entire codebase.
Usage: python extract_codebase.py
Output: codebase_export.txt
"""

import os
import fnmatch
from pathlib import Path

# Configuration
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(PROJECT_ROOT, "codebase_export.txt")
GITIGNORE_PATH = os.path.join(PROJECT_ROOT, ".gitignore")

# File extensions to include (None = include all text files)
INCLUDE_EXTENSIONS = {
    '.py', '.js', '.html', '.css', '.json', '.md', '.txt', '.yml', '.yaml',
    '.toml', '.ini', '.cfg', '.sh', '.bat', '.ps1', '.sql', '.env'
}

# Always ignore these patterns (in addition to .gitignore)
ALWAYS_IGNORE = {
    '.git', '.venv', 'venv', '__pycache__', 'node_modules',
    '.pytest_cache', 'data', '*.pyc', '*.pyo', '*.pyd',
    '*.db', '*.sqlite', '*.sqlite3', '*.log', '*.tmp'
}

def load_gitignore():
    """Load patterns from .gitignore file."""
    patterns = set()
    if os.path.exists(GITIGNORE_PATH):
        with open(GITIGNORE_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                # Skip comments and empty lines
                if not line or line.startswith('#'):
                    continue
                # Handle negation patterns (not supported, skip)
                if line.startswith('!'):
                    continue
                patterns.add(line)
    return patterns

def should_ignore(path, gitignore_patterns):
    """Check if path should be ignored based on gitignore and always-ignore patterns."""
    # Get relative path from project root
    rel_path = os.path.relpath(path, PROJECT_ROOT)
    
    # Check always-ignore patterns
    for pattern in ALWAYS_IGNORE:
        if fnmatch.fnmatch(os.path.basename(path), pattern):
            return True
        if fnmatch.fnmatch(rel_path, pattern):
            return True
    
    # Check gitignore patterns
    for pattern in gitignore_patterns:
        # Handle directory patterns (ending with /)
        if pattern.endswith('/'):
            dir_pattern = pattern.rstrip('/')
            if os.path.isdir(path) and fnmatch.fnmatch(os.path.basename(path), dir_pattern):
                return True
        # Handle file patterns
        if fnmatch.fnmatch(os.path.basename(path), pattern):
            return True
        # Handle path patterns
        if fnmatch.fnmatch(rel_path, pattern):
            return True
    
    return False

def count_lines(filepath):
    """Count lines in a file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return len(f.readlines())
    except Exception:
        return 0

def is_text_file(filepath):
    """Check if file is a text file based on extension."""
    if INCLUDE_EXTENSIONS is None:
        return True
    ext = os.path.splitext(filepath)[1].lower()
    return ext in INCLUDE_EXTENSIONS

def format_file_header(filepath, line_count):
    """Format the header for a file section."""
    rel_path = os.path.relpath(filepath, PROJECT_ROOT)
    separator = "=" * 80
    return f"\n{separator}\nFILE: {rel_path}\nLINES: {line_count}\n{separator}\n\n"

def extract_codebase():
    """Main function to extract the codebase."""
    print(f"Starting codebase extraction from: {PROJECT_ROOT}")
    
    # Load gitignore patterns
    gitignore_patterns = load_gitignore()
    print(f"Loaded {len(gitignore_patterns)} patterns from .gitignore")
    
    # Collect all files
    files_to_process = []
    
    for root, dirs, files in os.walk(PROJECT_ROOT):
        # Filter out ignored directories
        dirs[:] = [d for d in dirs if not should_ignore(os.path.join(root, d), gitignore_patterns)]
        
        for file in files:
            filepath = os.path.join(root, file)
            
            # Skip ignored files
            if should_ignore(filepath, gitignore_patterns):
                continue
            
            # Skip non-text files
            if not is_text_file(filepath):
                continue
            
            # Skip the output file itself and this script
            if file in ['codebase_export.txt', 'extract_codebase.py']:
                continue
            
            files_to_process.append(filepath)
    
    # Sort files for consistent output
    files_to_process.sort()
    
    print(f"Found {len(files_to_process)} files to process")
    
    # Write to output file
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out:
        # Write header
        out.write("CODEBASE EXPORT\n")
        out.write("=" * 80 + "\n")
        out.write(f"Project: Sentient Project\n")
        out.write(f"Root: {PROJECT_ROOT}\n")
        out.write(f"Total Files: {len(files_to_process)}\n")
        out.write(f"Extensions: {', '.join(sorted(INCLUDE_EXTENSIONS))}\n")
        out.write("=" * 80 + "\n")
        
        # Process each file
        for i, filepath in enumerate(files_to_process, 1):
            try:
                line_count = count_lines(filepath)
                header = format_file_header(filepath, line_count)
                out.write(header)
                
                # Read and write file content
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                    out.write(content)
                    if not content.endswith('\n'):
                        out.write('\n')
                
                print(f"[{i}/{len(files_to_process)}] Processed: {os.path.relpath(filepath, PROJECT_ROOT)} ({line_count} lines)")
                
            except Exception as e:
                error_msg = f"\n[ERROR reading {filepath}: {str(e)}]\n"
                out.write(error_msg)
                print(f"ERROR processing {filepath}: {e}")
    
    print(f"\nExtraction complete!")
    print(f"Output file: {OUTPUT_FILE}")
    
    # Get file size
    size = os.path.getsize(OUTPUT_FILE)
    print(f"File size: {size:,} bytes ({size/1024:.1f} KB)")

if __name__ == "__main__":
    extract_codebase()
