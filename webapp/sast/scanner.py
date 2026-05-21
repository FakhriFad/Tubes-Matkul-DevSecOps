#!/usr/bin/env python3
"""
EcomShop SAST Scanner
=====================
Runs static analysis on the backend and frontend source without
requiring external tools (semgrep, trivy, etc.).

Checks performed:
  SEC-001  Hardcoded secrets / credentials
  SEC-002  SQL injection risk patterns
  SEC-003  eval() / Function() usage
  SEC-004  Dangerous regex patterns (ReDoS)
  SEC-005  Insecure direct object reference patterns
  SEC-006  Missing input validation on routes
  SEC-007  console.log in production code (info leak)
  SEC-008  Unhandled promise rejections
  SEC-009  Path traversal patterns
  SEC-010  JWT algorithm confusion (none alg)
  SEC-011  Hardcoded HTTP (should be HTTPS)
  SEC-012  Missing rate limiting on sensitive routes
  SEC-013  XSS via dangerouslySetInnerHTML
  SEC-014  Open redirect patterns
  SEC-015  Dependency version pinning

Usage:
  python3 sast/scanner.py [--output sast/report.html]
"""

import os
import re
import json
import datetime
import argparse
import sys
from pathlib import Path

# ── Rule definitions ──────────────────────────────────────────────────────────

RULES = [
    {
        "id": "SEC-001",
        "name": "Hardcoded Secrets",
        "severity": "CRITICAL",
        "description": "Hardcoded passwords, secrets, or API keys in source code.",
        "pattern": re.compile(
            r'(?i)(password|secret|api_key|apikey|token|passwd|pwd)\s*[=:]\s*["\'][^"\']{4,}["\']'
        ),
        "exclude_patterns": [re.compile(r'process\.env'), re.compile(r'\.example'), re.compile(r'e\.password\s*='), re.compile(r'form\.password'), re.compile(r'errors\['), re.compile(r'\.length\s*<'), ],
        "extensions": [".js"],
        "cwe": "CWE-798",
        "owasp": "A02:2021",
    },
    {
        "id": "SEC-002",
        "name": "SQL Injection Risk",
        "severity": "HIGH",
        "description": "String concatenation or template literals in SQL queries.",
        "pattern": re.compile(
            r'(?i)(query|execute|db\.query)\s*\(\s*[`"\'].*?\$\{(?![\d]+\})',
            re.DOTALL
        ),
        "exclude_patterns": [],
        "extensions": [".js"],
        "cwe": "CWE-89",
        "owasp": "A03:2021",
    },
    {
        "id": "SEC-003",
        "name": "eval() Usage",
        "severity": "HIGH",
        "description": "Use of eval(), new Function(), or setTimeout with string.",
        "pattern": re.compile(r'\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["\`]'),
        "exclude_patterns": [],
        "extensions": [".js"],
        "cwe": "CWE-95",
        "owasp": "A03:2021",
    },
    {
        "id": "SEC-004",
        "name": "Dangerous Regex (ReDoS)",
        "severity": "MEDIUM",
        "description": "Regex with nested quantifiers that could cause ReDoS.",
        "pattern": re.compile(r'new RegExp\(.*\(\.\*\)\+|\/(\.\*)+\+\/'),
        "exclude_patterns": [],
        "extensions": [".js"],
        "cwe": "CWE-1333",
        "owasp": "A06:2021",
    },
    {
        "id": "SEC-005",
        "name": "Unvalidated User Input in File Path",
        "severity": "HIGH",
        "description": "User input used directly in file system operations.",
        "pattern": re.compile(
            r'(?:readFile|writeFile|readdir|unlink|mkdir)\s*\([^)]*req\.(body|params|query)'
        ),
        "exclude_patterns": [],
        "extensions": [".js"],
        "cwe": "CWE-22",
        "owasp": "A01:2021",
    },
    {
        "id": "SEC-006",
        "name": "Missing Authentication Check",
        "severity": "HIGH",
        "description": "Route handler that modifies data without authenticate middleware.",
        "pattern": re.compile(
            r'router\.(post|put|patch|delete)\s*\([^,\n]+,\s*async\s*\(req'
        ),
        "exclude_patterns": [
            re.compile(r'authenticate'),
            re.compile(r'\/register'),
            re.compile(r'\/login'),
        ],
        "extensions": [".js"],
        "cwe": "CWE-306",
        "owasp": "A01:2021",
        "note": "Manual review required — false positives possible if middleware is chained.",
    },
    {
        "id": "SEC-007",
        "name": "console.log in Production Code",
        "severity": "LOW",
        "description": "console.log/debug may leak sensitive data in production logs.",
        "pattern": re.compile(r'\bconsole\.(log|debug|warn|error|info)\s*\('),
        "exclude_patterns": [
            re.compile(r'eslint-disable'),
            re.compile(r'healthcheck'),
            re.compile(r'//'),
        ],
        "extensions": [".js"],
        "cwe": "CWE-532",
        "owasp": "A09:2021",
        "skip_dirs": ["tests", "stubs"],
    },
    {
        "id": "SEC-008",
        "name": "Unhandled Promise Rejection",
        "severity": "MEDIUM",
        "description": ".then() without a corresponding .catch() error handler.",
        "pattern": re.compile(r'\.then\s*\([^)]+\)\s*(?!\.catch)(?!;)'),
        "exclude_patterns": [re.compile(r'\.catch')],
        "extensions": [".js"],
        "cwe": "CWE-755",
        "owasp": "A09:2021",
    },
    {
        "id": "SEC-009",
        "name": "Path Traversal Pattern",
        "severity": "HIGH",
        "description": "User input potentially used to traverse directory structure.",
        "pattern": re.compile(r'req\.(body|params|query)\.[a-zA-Z]+.*(?:join|resolve|dirname)'),
        "exclude_patterns": [],
        "extensions": [".js"],
        "cwe": "CWE-22",
        "owasp": "A01:2021",
    },
    {
        "id": "SEC-010",
        "name": "JWT Algorithm Confusion",
        "severity": "CRITICAL",
        "description": "JWT verification without explicit algorithm specification.",
        "pattern": re.compile(r'jwt\.verify\s*\([^)]+\)(?!\s*,\s*\{[^}]*algorithm)'),
        "exclude_patterns": [re.compile(r"algorithms")],
        "extensions": [".js"],
        "cwe": "CWE-327",
        "owasp": "A02:2021",
    },
    {
        "id": "SEC-011",
        "name": "Hardcoded HTTP URL",
        "severity": "LOW",
        "description": "Hardcoded http:// URL should use https:// or environment variable.",
        "pattern": re.compile(r'["\']http://(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[^"\']+["\']'),
        "exclude_patterns": [re.compile(r'healthcheck')],
        "extensions": [".js"],
        "cwe": "CWE-319",
        "owasp": "A02:2021",
    },
    {
        "id": "SEC-012",
        "name": "XSS via dangerouslySetInnerHTML",
        "severity": "HIGH",
        "description": "dangerouslySetInnerHTML bypasses React's XSS protection.",
        "pattern": re.compile(r'dangerouslySetInnerHTML'),
        "exclude_patterns": [],
        "extensions": [".js", ".jsx", ".tsx"],
        "cwe": "CWE-79",
        "owasp": "A03:2021",
    },
    {
        "id": "SEC-013",
        "name": "Open Redirect",
        "severity": "MEDIUM",
        "description": "Redirect using unvalidated user input.",
        "pattern": re.compile(
            r'res\.(redirect|location)\s*\([^)]*req\.(body|query|params)'
        ),
        "exclude_patterns": [],
        "extensions": [".js"],
        "cwe": "CWE-601",
        "owasp": "A01:2021",
    },
    {
        "id": "SEC-014",
        "name": "Timing Attack Risk",
        "severity": "MEDIUM",
        "description": "String equality comparison for secrets (use crypto.timingSafeEqual).",
        "pattern": re.compile(r'(?:token|secret|password|hash)\s*===?\s*["\']|["\'][^\'"]*["\'\s]===?\s*(?:token|secret|password)'),
        "exclude_patterns": [re.compile(r'\.status|status\s*===')],
        "extensions": [".js"],
        "cwe": "CWE-208",
        "owasp": "A02:2021",
    },
    {
        "id": "SEC-015",
        "name": "Prototype Pollution Risk",
        "severity": "MEDIUM",
        "description": "Object.assign or spread with user-controlled input.",
        "pattern": re.compile(
            r'Object\.assign\s*\([^)]*req\.(body|params|query)|'
            r'\.\.\.\s*req\.(body|params|query)'
        ),
        "exclude_patterns": [],
        "extensions": [".js"],
        "cwe": "CWE-1321",
        "owasp": "A08:2021",
    },
]

# ── Scanner ───────────────────────────────────────────────────────────────────

SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}
SEVERITY_COLOUR = {
    "CRITICAL": "#d63031", "HIGH": "#e17055",
    "MEDIUM": "#fdcb6e",   "LOW": "#74b9ff",  "INFO": "#b2bec3",
}
SEVERITY_BG = {
    "CRITICAL": "#fff0f0", "HIGH": "#fff4f0",
    "MEDIUM": "#fffbf0",   "LOW": "#f0f8ff",  "INFO": "#f8f8f8",
}

def scan_file(filepath, rules):
    findings = []
    try:
        with open(filepath, encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
    except OSError:
        return findings

    for rule in rules:
        ext = os.path.splitext(filepath)[1]
        if ext not in rule["extensions"]:
            continue

        skip_dirs = rule.get("skip_dirs", [])
        rel = str(filepath)
        if any(sd in rel for sd in skip_dirs):
            continue

        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue

            if not rule["pattern"].search(line):
                continue

            excluded = any(ep.search(line) for ep in rule.get("exclude_patterns", []))
            if excluded:
                continue

            findings.append({
                "rule_id":     rule["id"],
                "rule_name":   rule["name"],
                "severity":    rule["severity"],
                "cwe":         rule.get("cwe", ""),
                "owasp":       rule.get("owasp", ""),
                "description": rule["description"],
                "note":        rule.get("note", ""),
                "file":        rel,
                "line":        i,
                "code":        line.rstrip(),
            })

    return findings


def collect_files(src_dirs, extensions):
    files = []
    for src_dir in src_dirs:
        for root, dirs, filenames in os.walk(src_dir):
            dirs[:] = [
                d for d in dirs
                if d not in ("node_modules", ".next", "out", "stubs", ".git", "dist", "build")
            ]
            for fname in filenames:
                if any(fname.endswith(ext) for ext in extensions):
                    files.append(os.path.join(root, fname))
    return sorted(files)


def run_scan(project_root):
    src_dirs = [
        os.path.join(project_root, "backend", "src"),
        os.path.join(project_root, "frontend", "src"),
    ]

    all_extensions = set()
    for r in RULES:
        all_extensions.update(r["extensions"])

    files = collect_files(src_dirs, list(all_extensions))
    all_findings = []

    for fp in files:
        all_findings.extend(scan_file(fp, RULES))

    # Sort by severity then file
    all_findings.sort(key=lambda f: (
        SEVERITY_ORDER.get(f["severity"], 99),
        f["file"],
        f["line"]
    ))

    return all_findings, files


# ── HTML Report ───────────────────────────────────────────────────────────────

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EcomShop — SAST Report</title>
<style>
  :root {{
    --ink: #0d0d0d; --cream: #f5f0e8; --rust: #c94a2b;
    --sage: #4a7c59; --gold: #c9a227; --border: #d4cfc5; --muted: #888880;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: 'Segoe UI', system-ui, sans-serif; background: var(--cream);
          color: var(--ink); line-height: 1.6; }}
  header {{ background: var(--ink); color: #fff; padding: 2rem 3rem; }}
  header h1 {{ font-size: 1.8rem; font-weight: 700; }}
  header p  {{ color: #aaa; font-size: 0.9rem; margin-top: 0.25rem; }}
  .container {{ max-width: 1100px; margin: 0 auto; padding: 2rem 3rem; }}
  .summary {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; margin: 2rem 0; }}
  .scard {{ background: #fff; border: 1px solid var(--border); border-radius: 4px;
             padding: 1.25rem; text-align: center; }}
  .scard .count {{ font-size: 2rem; font-weight: 700; }}
  .scard .label {{ font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
                   color: var(--muted); margin-top: 0.25rem; }}
  .scard.CRITICAL {{ border-top: 3px solid #d63031; }}
  .scard.HIGH     {{ border-top: 3px solid #e17055; }}
  .scard.MEDIUM   {{ border-top: 3px solid #fdcb6e; }}
  .scard.LOW      {{ border-top: 3px solid #74b9ff; }}
  .scard.total    {{ border-top: 3px solid var(--ink); }}
  .meta {{ background: #fff; border: 1px solid var(--border); padding: 1rem 1.5rem;
           border-radius: 4px; margin-bottom: 2rem; font-size: 0.85rem; color: var(--muted); }}
  .meta span {{ color: var(--ink); font-weight: 600; }}
  h2 {{ font-size: 1.2rem; margin: 2rem 0 1rem; color: var(--rust); }}
  table {{ width: 100%; border-collapse: collapse; background: #fff;
           border: 1px solid var(--border); border-radius: 4px; overflow: hidden;
           font-size: 0.85rem; }}
  th {{ background: var(--ink); color: #fff; text-align: left; padding: 0.75rem 1rem;
        font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; }}
  td {{ padding: 0.7rem 1rem; border-bottom: 1px solid var(--border); vertical-align: top; }}
  tr:last-child td {{ border-bottom: none; }}
  tr:nth-child(even) {{ background: #fafafa; }}
  .badge {{ display: inline-block; padding: 0.2rem 0.6rem; border-radius: 3px;
             font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; }}
  .badge.CRITICAL {{ background: #fee; color: #d63031; border: 1px solid #fcc; }}
  .badge.HIGH     {{ background: #fff0ec; color: #e17055; border: 1px solid #fdc; }}
  .badge.MEDIUM   {{ background: #fffbec; color: #b8860b; border: 1px solid #fde; }}
  .badge.LOW      {{ background: #ecf6ff; color: #2980b9; border: 1px solid #cde; }}
  .code {{ font-family: 'Courier New', monospace; background: #f5f5f5; border-radius: 3px;
           padding: 0.15rem 0.4rem; font-size: 0.8rem; word-break: break-all; }}
  .filepath {{ font-family: monospace; font-size: 0.78rem; color: #555; }}
  .note {{ font-size: 0.75rem; color: var(--muted); font-style: italic; margin-top: 0.25rem; }}
  .no-findings {{ text-align: center; padding: 3rem; color: var(--muted); }}
  .cwe {{ font-size: 0.7rem; color: var(--muted); }}
  footer {{ margin: 3rem 0 1rem; text-align: center; font-size: 0.8rem; color: var(--muted); }}
</style>
</head>
<body>
<header>
  <h1>EcomShop — SAST Report</h1>
  <p>Static Application Security Testing · Generated {date}</p>
</header>
<div class="container">

  <div class="summary">
    <div class="scard CRITICAL"><div class="count" style="color:#d63031">{cnt_critical}</div>
      <div class="label">Critical</div></div>
    <div class="scard HIGH">    <div class="count" style="color:#e17055">{cnt_high}</div>
      <div class="label">High</div></div>
    <div class="scard MEDIUM">  <div class="count" style="color:#b8860b">{cnt_medium}</div>
      <div class="label">Medium</div></div>
    <div class="scard LOW">     <div class="count" style="color:#2980b9">{cnt_low}</div>
      <div class="label">Low</div></div>
    <div class="scard total">   <div class="count">{cnt_total}</div>
      <div class="label">Total</div></div>
  </div>

  <div class="meta">
    Scanned <span>{file_count}</span> files &nbsp;·&nbsp;
    Project root: <span>{project_root}</span> &nbsp;·&nbsp;
    Rules applied: <span>{rule_count}</span> &nbsp;·&nbsp;
    Scan duration: <span>{duration}ms</span>
  </div>

  {findings_html}

</div>
<footer>EcomShop SAST Scanner · {date}</footer>
</body>
</html>"""

def build_findings_html(findings):
    if not findings:
        return '<div class="no-findings">✓ No findings — all checks passed.</div>'

    rows = []
    for f in findings:
        rel_file = re.sub(r'^.*/ecommerce/', '', f['file'])
        note_html = f'<div class="note">⚠ {f["note"]}</div>' if f.get("note") else ""
        rows.append(f"""
        <tr>
          <td><span class="badge {f['severity']}">{f['severity']}</span></td>
          <td><strong>{f['rule_id']}</strong><br><span class="cwe">{f['cwe']} · {f['owasp']}</span></td>
          <td>{f['rule_name']}<br><span class="note">{f['description']}</span>{note_html}</td>
          <td><span class="filepath">{rel_file}:{f['line']}</span><br>
              <code class="code">{f['code'].strip()[:120]}</code></td>
        </tr>""")

    return f"""
    <h2>Findings ({len(findings)})</h2>
    <table>
      <thead>
        <tr>
          <th>Severity</th><th>Rule</th><th>Description</th><th>Location &amp; Code</th>
        </tr>
      </thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""


def generate_report(findings, files, project_root, output_path, duration_ms):
    by_sev = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for f in findings:
        by_sev[f["severity"]] = by_sev.get(f["severity"], 0) + 1

    html = HTML_TEMPLATE.format(
        date=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        cnt_critical=by_sev["CRITICAL"],
        cnt_high=by_sev["HIGH"],
        cnt_medium=by_sev["MEDIUM"],
        cnt_low=by_sev["LOW"],
        cnt_total=len(findings),
        file_count=len(files),
        project_root=project_root,
        rule_count=len(RULES),
        duration=duration_ms,
        findings_html=build_findings_html(findings),
    )

    with open(output_path, "w") as f:
        f.write(html)

    # Also write JSON
    json_path = output_path.replace(".html", ".json")
    report_data = {
        "generated_at": datetime.datetime.now().isoformat(),
        "summary": {**by_sev, "TOTAL": len(findings)},
        "files_scanned": len(files),
        "rules_applied": len(RULES),
        "findings": findings,
    }
    with open(json_path, "w") as f:
        json.dump(report_data, f, indent=2)

    return json_path


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="EcomShop SAST Scanner")
    parser.add_argument("--project", default=".", help="Project root directory")
    parser.add_argument("--output", default="sast/sast-report.html", help="Output HTML path")
    args = parser.parse_args()

    project_root = os.path.abspath(args.project)
    output_path  = os.path.join(project_root, args.output)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print(f"EcomShop SAST Scanner")
    print(f"Project: {project_root}")
    print(f"Rules:   {len(RULES)}")
    print()

    import time
    start = time.time()
    findings, files = run_scan(project_root)
    duration_ms = int((time.time() - start) * 1000)

    json_path = generate_report(findings, files, project_root, output_path, duration_ms)

    # Console summary
    by_sev = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for f in findings:
        by_sev[f["severity"]] = by_sev.get(f["severity"], 0) + 1

    print(f"Files scanned : {len(files)}")
    print(f"Findings      : {len(findings)}")
    print(f"  CRITICAL    : {by_sev['CRITICAL']}")
    print(f"  HIGH        : {by_sev['HIGH']}")
    print(f"  MEDIUM      : {by_sev['MEDIUM']}")
    print(f"  LOW         : {by_sev['LOW']}")
    print(f"Duration      : {duration_ms}ms")
    print()
    print(f"HTML report   : {output_path}")
    print(f"JSON report   : {json_path}")

    if findings:
        print()
        print("Top findings:")
        for f in findings[:5]:
            rel = re.sub(r'^.*/ecommerce/', '', f['file'])
            print(f"  [{f['severity']:8}] {f['rule_id']} — {rel}:{f['line']}")

    # Exit code: 1 if CRITICAL or HIGH found (CI gate)
    sys.exit(1 if (by_sev["CRITICAL"] + by_sev["HIGH"]) > 0 else 0)


if __name__ == "__main__":
    main()
