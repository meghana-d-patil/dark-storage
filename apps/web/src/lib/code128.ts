/**
 * Pure TypeScript Code 128 Subset B Encoder & SVG Path Generator
 * Strictly adheres to ISO/IEC 15417 Code 128 specification.
 */

export const CODE128_START_B = 104;
export const CODE128_STOP = 106;

/**
 * Standard Code 128 pattern table (0..106).
 * Each pattern specifies alternating bar and space widths in modules.
 * Symbols 0..105 have 6 elements totaling 11 modules.
 * Symbol 106 (stop) has 7 elements totaling 13 modules.
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

export interface Code128Encoding {
  text: string;
  symbols: number[];
  checksum: number;
  moduleWidths: number[];
  totalModules: number;
}

/**
 * Encodes ASCII string into Code 128 subset B symbols, checksum, and module widths.
 * Test vector: 'SKU001' -> symbols [104, 51, 43, 53, 16, 16, 17, 28, 106] (checksum 28).
 */
export function encodeCode128B(text: string): Code128Encoding {
  if (!text) {
    throw new Error('Code 128 text cannot be empty');
  }

  const symbols: number[] = [CODE128_START_B];
  let sum = CODE128_START_B;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32;
    if (code < 0 || code > 95) {
      throw new Error(`Invalid Code 128B character "${text[i]}" at index ${i}`);
    }
    symbols.push(code);
    sum += code * (i + 1);
  }

  const checksum = sum % 103;
  symbols.push(checksum);
  symbols.push(CODE128_STOP);

  const moduleWidths: number[] = [];
  for (const s of symbols) {
    const pattern = CODE128_PATTERNS[s];
    for (let j = 0; j < pattern.length; j++) {
      moduleWidths.push(Number(pattern[j]));
    }
  }

  const totalModules = moduleWidths.reduce((a, b) => a + b, 0);

  return {
    text,
    symbols,
    checksum,
    moduleWidths,
    totalModules
  };
}

export interface BarcodePathResult {
  pathData: string;
  totalWidth: number;
  totalHeight: number;
  quietZoneModules: number;
}

/**
 * Generates an SVG path 'd' string representing all bars in a single path element.
 * Follows 10-module quiet zones on both left and right.
 */
export function generateBarcodeSvgPath(
  symbols: number[],
  moduleWidth = 2,
  barHeight = 50,
  quietZoneModules = 10
): BarcodePathResult {
  const quietZoneWidth = quietZoneModules * moduleWidth;
  let currentX = quietZoneWidth;
  const pathParts: string[] = [];

  for (const s of symbols) {
    const pattern = CODE128_PATTERNS[s];
    for (let k = 0; k < pattern.length; k++) {
      const width = Number(pattern[k]) * moduleWidth;
      // Even index represents a bar (black); odd index represents a space (white)
      if (k % 2 === 0) {
        pathParts.push(`M ${currentX.toFixed(2)} 0 h ${width.toFixed(2)} v ${barHeight.toFixed(2)} h -${width.toFixed(2)} Z`);
      }
      currentX += width;
    }
  }

  const totalWidth = currentX + quietZoneWidth;
  const totalHeight = barHeight;

  return {
    pathData: pathParts.join(' '),
    totalWidth,
    totalHeight,
    quietZoneModules
  };
}
