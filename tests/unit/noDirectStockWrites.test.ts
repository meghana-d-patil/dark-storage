import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Guard: No Direct Stock Writes outside ledger', () => {
  it('ensures no files outside ledger/ write directly to inventory or current_qty', () => {
    const srcDir = path.resolve(process.cwd(), 'services/engine3-inventory/src');

    function scanDir(dir: string): string[] {
      const files: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...scanDir(fullPath));
        } else if (entry.isFile() && fullPath.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const allTsFiles = scanDir(srcDir);
    const forbiddenPatterns = [
      /\bUPDATE\s+inventory\b/i,
      /\bINSERT\s+INTO\s+inventory\b/i,
      /\bDELETE\s+FROM\s+inventory\b/i,
      /\bcurrent_qty\s*=/i,
    ];

    const violations: Array<{ file: string; line: number; matchedText: string }> = [];

    for (const file of allTsFiles) {
      const relative = path.relative(srcDir, file).replace(/\\/g, '/');

      // Allowed exceptions: ledger/postLedger.ts and ledger/backfill*.ts
      if (relative === 'ledger/postLedger.ts' || relative.startsWith('ledger/backfill')) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        for (const pattern of forbiddenPatterns) {
          if (pattern.test(line)) {
            violations.push({
              file: relative,
              line: index + 1,
              matchedText: line.trim(),
            });
          }
        }
      });
    }

    expect(
      violations,
      `Found direct stock writes outside ledger:\n${JSON.stringify(violations, null, 2)}`
    ).toHaveLength(0);
  });
});
