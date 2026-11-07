import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  encodeCode128B,
  generateBarcodeSvgPath,
  CODE128_PATTERNS,
  CODE128_START_B,
  CODE128_STOP
} from '../../apps/web/src/lib/code128.js';

describe('Phase 7: Printable Barcode Labels', () => {
  const barcodeSvgSource = fs.readFileSync(
    path.resolve('apps/web/src/components/BarcodeSvg.tsx'),
    'utf8'
  );
  const modalSource = fs.readFileSync(
    path.resolve('apps/web/src/components/LabelPrintModal.tsx'),
    'utf8'
  );
  const warehouseSource = fs.readFileSync(
    path.resolve('apps/web/src/pages/WarehousePage.tsx'),
    'utf8'
  );
  const inventorySource = fs.readFileSync(
    path.resolve('apps/web/src/pages/InventoryPage.tsx'),
    'utf8'
  );
  const receivingSource = fs.readFileSync(
    path.resolve('apps/web/src/pages/ReceivingPage.tsx'),
    'utf8'
  );
  const adminSource = fs.readFileSync(
    path.resolve('apps/web/src/pages/AdminPage.tsx'),
    'utf8'
  );

  describe('1. Code 128 Subset B Encoder Test Vectors (PRD Specification)', () => {
    it('encodes SKU001 to exact symbol vector [104, 51, 43, 53, 16, 16, 17, 28, 106] with checksum 28', () => {
      const result = encodeCode128B('SKU001');
      expect(result.symbols).toEqual([104, 51, 43, 53, 16, 16, 17, 28, 106]);
      expect(result.checksum).toBe(28);
      expect(result.symbols[0]).toBe(CODE128_START_B);
      expect(result.symbols[result.symbols.length - 1]).toBe(CODE128_STOP);
    });

    it('encodes bin location A-01-L-1 to exact symbol vector with checksum 11', () => {
      const result = encodeCode128B('A-01-L-1');
      expect(result.symbols).toEqual([104, 33, 13, 16, 17, 13, 44, 13, 17, 11, 106]);
      expect(result.checksum).toBe(11);
    });

    it('encodes receipt reference RCV-0001 to exact symbol vector with checksum 38', () => {
      const result = encodeCode128B('RCV-0001');
      expect(result.symbols).toEqual([104, 50, 35, 54, 13, 16, 16, 16, 17, 38, 106]);
      expect(result.checksum).toBe(38);
    });

    it('throws error for empty string or non-ASCII characters', () => {
      expect(() => encodeCode128B('')).toThrow('Code 128 text cannot be empty');
      expect(() => encodeCode128B('SKU\u0001')).toThrow(/Invalid Code 128B character/);
    });
  });

  describe('2. Pattern Table & Module Specification (ISO/IEC 15417)', () => {
    it('defines exactly 107 patterns (0..106)', () => {
      expect(CODE128_PATTERNS.length).toBe(107);
    });

    it('ensures every symbol 0..105 has sum of modules equal to 11', () => {
      for (let i = 0; i < 106; i++) {
        const sum = CODE128_PATTERNS[i].split('').reduce((acc, digit) => acc + Number(digit), 0);
        expect(sum).toBe(11);
      }
    });

    it('ensures stop symbol 106 has sum of modules equal to 13 (pattern 2331112)', () => {
      expect(CODE128_PATTERNS[106]).toBe('2331112');
      const stopSum = CODE128_PATTERNS[106].split('').reduce((acc, digit) => acc + Number(digit), 0);
      expect(stopSum).toBe(13);
    });
  });

  describe('3. Single-Path SVG Generation with Quiet Zones', () => {
    it('generates a single SVG path string with 10-module quiet zones', () => {
      const encoding = encodeCode128B('SKU001');
      const moduleWidth = 2;
      const barHeight = 48;
      const quietZoneModules = 10;

      const pathRes = generateBarcodeSvgPath(
        encoding.symbols,
        moduleWidth,
        barHeight,
        quietZoneModules
      );

      expect(typeof pathRes.pathData).toBe('string');
      // Starts with M for path move
      expect(pathRes.pathData.startsWith('M ')).toBe(true);
      // Contains h, v, Z commands for drawing rects in a single path
      expect(pathRes.pathData).toContain('h ');
      expect(pathRes.pathData).toContain('v ');
      expect(pathRes.pathData).toContain('Z');

      // Total width must equal (10 + encoding.totalModules + 10) * moduleWidth
      const expectedTotalWidth = (10 + encoding.totalModules + 10) * moduleWidth;
      expect(pathRes.totalWidth).toBe(expectedTotalWidth);
      expect(pathRes.totalHeight).toBe(barHeight);
    });
  });

  describe('4. UI Contract & Test IDs', () => {
    it('verifies BarcodeSvg renders data-testid="barcode-svg" with single path and no rects', () => {
      expect(barcodeSvgSource).toContain('data-testid="barcode-svg"');
      expect(barcodeSvgSource).toContain('<path d={result.pathData} fill="#000000" />');
      // Must not render individual rect tags per bar
      expect(barcodeSvgSource).not.toContain('<rect');
    });

    it('verifies LabelPrintModal contains all required data-testid attributes', () => {
      expect(modalSource).toContain('data-testid="label-modal"');
      expect(modalSource).toContain('data-testid="label-tab-receipt"');
      expect(modalSource).toContain('data-testid="label-tab-bin"');
      expect(modalSource).toContain('data-testid="label-tab-sku"');
      expect(modalSource).toContain('data-testid="label-print-btn"');
    });

    it('verifies entry points exist on Warehouse, Inventory, Receiving, and Admin pages', () => {
      // WarehousePage
      expect(warehouseSource).toContain('LabelPrintModal');
      expect(warehouseSource).toContain('setPrintModalOpen(true)');

      // InventoryPage
      expect(inventorySource).toContain('LabelPrintModal');
      expect(inventorySource).toContain('setLabelModalOpen(true)');

      // ReceivingPage
      expect(receivingSource).toContain('LabelPrintModal');
      expect(receivingSource).toContain('setLabelModalOpen(true)');

      // AdminPage
      expect(adminSource).toContain('data-testid="admin-open-label-studio"');
      expect(adminSource).toContain('LabelPrintModal');
    });
  });
});
