---
name: pdf-analyzer
description: Process complex PDF documents using MinerU. Use when standard PDF reading fails, or when PDF contains complex tables, formulas, multi-column layouts, or scanned content.
allowed-tools: Bash(mineru *), Bash(pip *), Bash(which *), Bash(mkdir *), Bash(ls *), Read
---

When standard PDF reading produces garbled or incomplete results, use MinerU to convert PDF to Markdown.

## When to Use

Use this skill when:
- PDF contains complex tables that render incorrectly
- PDF contains mathematical formulas or equations
- PDF is a scanned document or image-based PDF
- PDF has multi-column layout that gets mixed up
- Standard PDF reading returns garbled or missing content
- User explicitly requests MinerU or high-quality PDF extraction

Do NOT use this skill when:
- Standard PDF reading works correctly
- PDF is simple text-only document
- Quick preview is sufficient

## Prerequisites

First check if MinerU is installed:

```bash
which mineru || pip show mineru
```

If not installed:

```bash
pip install -U "mineru[all]"
```

## Convert PDF

**IMPORTANT: Always output to `.mineru-output/` directory in the current workspace.**

```bash
mkdir -p .mineru-output
mineru -p "$ARGUMENTS" -o "./.mineru-output"
```

For systems without GPU, use pipeline backend:

```bash
mineru -p "$ARGUMENTS" -o "./.mineru-output" -b pipeline
```

## Output Location

MinerU outputs files to `.mineru-output/<pdf-name>/`:

```
.mineru-output/
└── <pdf-name>/
    ├── <pdf-name>.md      # Main Markdown content
    ├── images/            # Extracted images
    └── <pdf-name>.json    # Structured data (optional)
```

## Read Results

After conversion, list and read the output:

```bash
ls -la .mineru-output/
```

Then read the generated `.md` file for the converted content.

## Notes

- First run downloads model files (~5GB)
- Large PDFs take significant time to process
- RAM: 16GB minimum, 32GB recommended
- SSD storage recommended for better performance
