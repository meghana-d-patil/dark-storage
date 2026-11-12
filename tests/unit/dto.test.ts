import { describe, it, expect } from 'vitest';
import { toPickerMissionDTO, toPickerStopDTO } from '../../services/engine3-inventory/src/dto/floorDtos.js';

describe('REF-8: Floor DTO Security & Privacy Guard (D15 Blind Picker)', () => {
  it('ensures no forbidden warehouse/customer/price fields leak into PickerMissionDTO', () => {
    // Rich input simulating raw database join with internal and forbidden fields
    const richRawStop = {
      stop_ref: 'MSN-001-S01',
      seq: 1,
      bin_code: 'Z1-R02-B04',
      aisle: 'A',
      sku: 'SKU001',
      product_name: 'Wireless Mouse',
      qty_required: 5,
      qty_picked: 0,
      step: 'PENDING',
      tote_code: null,
      order_ref: 'ORD-101',
      // Forbidden fields that might exist in db rows
      currentQty: 25,
      reservedQty: 5,
      availableQty: 20,
      customerName: 'John Doe',
      customerEmail: 'john@example.com',
      addressLine1: '123 Warehouse St',
      phone: '+1-555-0199',
      price_paise: 149900,
      priceTotal: 749500,
      otherOrders: ['ORD-102', 'ORD-103'],
    };

    const richRawMission = {
      ref: 'MSN-001',
      status: 'CLAIMED',
      lease_expires_at: '2026-11-12T20:30:00.000Z',
      tote_code: null,
      stops: [richRawStop],
      customerDetails: { name: 'Secret Customer' },
      orderValuePaise: 500000,
    };

    const stopDto = toPickerStopDTO(richRawStop as any);
    const missionDto = toPickerMissionDTO(richRawMission as any);

    // Deep key inspection function
    function getAllKeys(obj: any, prefix = ''): string[] {
      const keys: string[] = [];
      if (!obj || typeof obj !== 'object') return keys;

      for (const [key, value] of Object.entries(obj)) {
        keys.push(key);
        if (value && typeof value === 'object') {
          keys.push(...getAllKeys(value, `${key}.`));
        }
      }
      return keys;
    }

    const forbiddenPatterns = [
      /^current_?qty/i,
      /^reserved_?qty/i,
      /^available_?qty/i,
      /^customer/i,
      /^address/i,
      /^phone/i,
      /^price/i,
      /^other_?orders/i,
    ];

    const allStopKeys = getAllKeys(stopDto);
    const allMissionKeys = getAllKeys(missionDto);
    const combinedKeys = [...allStopKeys, ...allMissionKeys];

    for (const key of combinedKeys) {
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(key),
          `Forbidden key '${key}' detected in Picker DTO! Must never expose internal quantities, prices, or customer details to pickers.`
        ).toBe(false);
      }
    }

    // Verify legitimate fields are present
    expect(missionDto.missionRef).toBe('MSN-001');
    expect(missionDto.stops[0].binCode).toBe('Z1-R02-B04');
    expect(missionDto.stops[0].qtyToPick).toBe(5);
    expect(missionDto.stops[0].step).toBe('SCAN_BIN');
  });
});
