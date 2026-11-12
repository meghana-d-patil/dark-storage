import Database from 'better-sqlite3';
import { DomainError, transition } from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { audit } from './audit.js';
import { appendOrderEvent } from '../audit/appendAudit.js';
import { emit } from './outbox.js';
import { postLedger, ensureLot } from '../ledger/postLedger.js';
import { createFloorTask } from './pickerRepo.js';
import { assertBinFree } from './exceptionsRepo.js';

export function submitBlindCount(
  db: Database.Database,
  taskRef: string,
  params: { binScan: string; countedQty: number },
  actor: { id: number; role: string; username: string }
): { ok: boolean; taskRef: string; status: string; round: number } {
  return db.transaction(() => {
    const task = db.prepare('SELECT * FROM floor_tasks WHERE task_ref = ?').get(taskRef) as any;
    if (!task) {
      throw new DomainError('NOT_FOUND', `Floor task ${taskRef} not found`, {}, 404);
    }

    if (task.type !== 'COUNT') {
      throw new DomainError('STATE_CONFLICT', `Task is of type ${task.type}, expected COUNT`, {}, 409);
    }

    if (task.assigned_to !== actor.username) {
      throw new DomainError('MISSION_NOT_OWNED', 'You do not own this count task', {}, 403);
    }

    const cleanScan = params.binScan.trim().toUpperCase();
    if (cleanScan !== task.bin_code.toUpperCase()) {
      throw new DomainError('SCAN_WRONG_BIN', `Scanned bin '${cleanScan}' does not match expected bin '${task.bin_code}'`, {}, 422);
    }

    // Compute system_qty from location_balances (never from projection)
    const sysRow = db.prepare(`
      SELECT COALESCE(SUM(qty), 0) as system_qty
      FROM location_balances
      WHERE location_key = ? AND (sku = ? OR ? IS NULL)
    `).get(`BIN:${task.bin_code}`, task.sku, task.sku) as { system_qty: number };

    const systemQty = sysRow.system_qty;
    const countedQty = params.countedQty;
    const variance = countedQty - systemQty;

    // Check round
    let round = 1;
    if (task.payload) {
      try {
        const p = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
        if (p.round) round = Number(p.round);
      } catch {}
    }

    const nowIso = new Date().toISOString();

    // Insert count result
    db.prepare(`
      INSERT INTO count_results (
        task_ref, bin_code, sku, counted_qty, system_qty, variance, counted_by, counted_at, round
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskRef, task.bin_code, task.sku, countedQty, systemQty, variance, actor.username, nowIso, round);

    if (variance === 0) {
      // Perfect match: complete task, update last_counted_at
      db.prepare(`UPDATE floor_tasks SET status = 'DONE', completed_at = ? WHERE id = ?`).run(nowIso, task.id);
      db.prepare(`UPDATE bins SET last_counted_at = ? WHERE code = ?`).run(nowIso, task.bin_code);

      // Link exception status -> COUNT_SUBMITTED
      db.prepare(`
        UPDATE pick_exceptions
        SET status = 'COUNT_SUBMITTED'
        WHERE count_task_ref = ? AND status = 'COUNT_REQUESTED'
      `).run(taskRef);

      audit(db, {
        actor,
        action: 'COUNT_COMPLETED_ACCURATE',
        entity_type: 'FLOOR_TASK',
        entity_id: taskRef,
        details: { bin_code: task.bin_code, round },
      });
    } else {
      // Variance exists!
      const variancePct = (Math.abs(variance) / Math.max(systemQty, 1)) * 100;
      const recountThreshold = 10; // 10% from config

      if (round === 1 && variancePct > recountThreshold) {
        // High variance round 1: complete task and spawn round 2 for another counter
        db.prepare(`UPDATE floor_tasks SET status = 'DONE', completed_at = ? WHERE id = ?`).run(nowIso, task.id);

        const r2Ref = createFloorTask(db, {
          type: 'COUNT',
          binCode: task.bin_code,
          sku: task.sku,
          priority: 90,
          createdBy: 'SYSTEM',
          orderRef: task.order_ref || undefined,
          payload: { round: 2, previous_counter: actor.username },
        });

        db.prepare(`
          UPDATE pick_exceptions
          SET count_task_ref = ?
          WHERE count_task_ref = ?
        `).run(r2Ref, taskRef);

        audit(db, {
          actor,
          action: 'COUNT_ROUND2_TRIGGERED',
          entity_type: 'FLOOR_TASK',
          entity_id: taskRef,
          details: { bin_code: task.bin_code, variance_pct: variancePct },
        });
      } else {
        // Variance submitted as an inventory adjustment request
        db.prepare(`UPDATE floor_tasks SET status = 'DONE', completed_at = ? WHERE id = ?`).run(nowIso, task.id);

        const prod = db.prepare('SELECT price_paise FROM products WHERE sku = ?').get(task.sku) as
          | { price_paise: number }
          | undefined;
        const unitPrice = prod?.price_paise || 10000;
        const valuePaise = Math.abs(variance) * unitPrice;
        const adjRef = nextRef(db, 'ADJ');

        db.prepare(`
          INSERT INTO inventory_adjustments (
            adj_ref, kind, status, bin_code, sku, delta_qty, value_paise,
            reason_code, requested_by, requested_at, source_ref
          ) VALUES (
            ?, 'COUNT_VARIANCE', 'PENDING_MANAGER', ?, ?, ?, ?,
            'COUNT_VARIANCE', ?, ?, ?
          )
        `).run(adjRef, task.bin_code, task.sku, variance, valuePaise, actor.username, nowIso, taskRef);

        db.prepare(`
          UPDATE pick_exceptions
          SET status = 'COUNT_SUBMITTED'
          WHERE count_task_ref = ? AND status = 'COUNT_REQUESTED'
        `).run(taskRef);

        emit(db, {
          event_type: 'adjustment.requested',
          entity_type: 'ADJUSTMENT',
          entity_id: adjRef,
          data: { adj_ref: adjRef, bin_code: task.bin_code, sku: task.sku, delta_qty: variance },
        });

        audit(db, {
          actor,
          action: 'ADJUSTMENT_REQUESTED',
          entity_type: 'ADJUSTMENT',
          entity_id: adjRef,
          details: { delta_qty: variance, value_paise: valuePaise },
        });
      }
    }

    // D15 / D23: response NEVER contains system_qty or variance
    return { ok: true, taskRef: task.task_ref, status: 'DONE', round };
  })();
}

export function requestAdjustment(
  db: Database.Database,
  params: { binCode: string; sku: string; deltaQty: number; reasonCode: string; note?: string },
  actor: { id: number; role: string; username: string }
): { ok: boolean; adjRef: string; status: string } {
  return db.transaction(() => {
    const adjRef = nextRef(db, 'ADJ');
    const kind = params.reasonCode === 'DAMAGED' ? 'DAMAGE_WRITE_OFF' : 'COUNT_VARIANCE';

    const prod = db.prepare('SELECT price_paise FROM products WHERE sku = ?').get(params.sku) as
      | { price_paise: number }
      | undefined;
    const unitPrice = prod?.price_paise || 10000;
    const valuePaise = Math.abs(params.deltaQty) * unitPrice;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO inventory_adjustments (
        adj_ref, kind, status, bin_code, sku, delta_qty, value_paise,
        reason_code, note, requested_by, requested_at
      ) VALUES (
        ?, ?, 'PENDING_MANAGER', ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `).run(adjRef, kind, params.binCode, params.sku, params.deltaQty, valuePaise, params.reasonCode, params.note || null, actor.username, nowIso);

    audit(db, {
      actor,
      action: 'ADJUSTMENT_REQUESTED',
      entity_type: 'ADJUSTMENT',
      entity_id: adjRef,
      details: { kind, bin_code: params.binCode, sku: params.sku, delta_qty: params.deltaQty },
    });

    return { ok: true, adjRef, status: 'PENDING_MANAGER' };
  })();
}

export function getAdjustments(db: Database.Database, queryStatus?: string): { items: any[] } {
  const where = queryStatus ? 'WHERE status = ?' : '';
  const rows = db.prepare(`
    SELECT * FROM inventory_adjustments
    ${where}
    ORDER BY id DESC
  `).all(...(queryStatus ? [queryStatus] : []));

  return { items: rows };
}

export function approveAdjustment(
  db: Database.Database,
  adjRef: string,
  params: { note?: string },
  actor: { id: number; role: string; username: string }
): { ok: boolean; status: string } {
  return db.transaction(() => {
    const adj = db.prepare('SELECT * FROM inventory_adjustments WHERE adj_ref = ?').get(adjRef) as any;
    if (!adj) {
      throw new DomainError('NOT_FOUND', `Adjustment ${adjRef} not found`, {}, 404);
    }

    // Dual-control: Requester cannot approve their own adjustment
    if (actor.username === adj.requested_by) {
      throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'Requester cannot approve their own adjustment', {}, 403);
    }

    const nowIso = new Date().toISOString();
    const adminThresholdPaise = 5000 * 100; // 5000 INR

    if (adj.status === 'PENDING_MANAGER') {
      if (adj.value_paise >= adminThresholdPaise) {
        // High value: promote to PENDING_ADMIN
        transition('ADJUSTMENT', adj.status, 'approve_high');
        db.prepare(`
          UPDATE inventory_adjustments
          SET status = 'PENDING_ADMIN', manager_id = ?, manager_at = ?, version = version + 1
          WHERE id = ?
        `).run(actor.username, nowIso, adj.id);

        emit(db, {
          event_type: 'adjustment.approved_manager',
          entity_type: 'ADJUSTMENT',
          entity_id: adjRef,
          data: { adj_ref: adjRef, manager: actor.username },
        });

        audit(db, {
          actor,
          action: 'ADJUSTMENT_PROMOTED_ADMIN',
          entity_type: 'ADJUSTMENT',
          entity_id: adjRef,
          details: { value_paise: adj.value_paise },
        });

        return { ok: true, status: 'PENDING_ADMIN' };
      }
    } else if (adj.status === 'PENDING_ADMIN') {
      // Second approval: admin must differ from manager approver
      if (actor.username === adj.manager_id) {
        throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'Admin approver must differ from manager approver', {}, 403);
      }
    }

    // Apply adjustment!
    const event = adj.status === 'PENDING_MANAGER' ? 'approve_low' : 'approve';
    transition('ADJUSTMENT', adj.status, event);

    let lotId = adj.lot_id;
    if (!lotId) {
      const locKey = adj.kind === 'DAMAGE_WRITE_OFF' ? 'QUAR' : `BIN:${adj.bin_code}`;
      const bal = db.prepare(`
        SELECT lot_id FROM location_balances
        WHERE location_key = ? AND sku = ? AND qty > 0
        ORDER BY qty DESC LIMIT 1
      `).get(locKey, adj.sku) as { lot_id: string } | undefined;
      lotId = bal?.lot_id || `LOT-LEGACY-${adj.sku}`;
    }
    ensureLot(db, { lotId, sku: adj.sku });

    if (adj.kind === 'DAMAGE_WRITE_OFF') {
      // Stock already moved to QUAR -> write off to LOST
      postLedger(
        db,
        [
          {
            sku: adj.sku,
            lotId,
            qty: Math.abs(adj.delta_qty),
            from: 'QUAR',
            to: 'LOST',
            type: 'WRITE_OFF',
            refType: 'ADJUSTMENT',
            refId: adjRef,
          },
        ],
        { id: String(actor.id) }
      );
    } else if (adj.delta_qty < 0) {
      // Loss: BIN -> LOST
      postLedger(
        db,
        [
          {
            sku: adj.sku,
            lotId,
            qty: Math.abs(adj.delta_qty),
            from: `BIN:${adj.bin_code}`,
            to: 'LOST',
            type: 'ADJUST_OUT',
            refType: 'ADJUSTMENT',
            refId: adjRef,
          },
        ],
        { id: String(actor.id) }
      );
    } else if (adj.delta_qty > 0) {
      // Gain: EXT -> BIN
      postLedger(
        db,
        [
          {
            sku: adj.sku,
            lotId,
            qty: adj.delta_qty,
            from: 'EXT',
            to: `BIN:${adj.bin_code}`,
            type: 'ADJUST_IN',
            refType: 'ADJUSTMENT',
            refId: adjRef,
          },
        ],
        { id: String(actor.id) }
      );
    }

    db.prepare(`
      UPDATE inventory_adjustments
      SET status = 'APPLIED', admin_id = ?, admin_at = ?, version = version + 1
      WHERE id = ?
    `).run(actor.username, nowIso, adj.id);

    emit(db, {
      event_type: 'adjustment.applied',
      entity_type: 'ADJUSTMENT',
      entity_id: adjRef,
      data: { adj_ref: adjRef, delta_qty: adj.delta_qty },
    });

    audit(db, {
      actor,
      action: 'ADJUSTMENT_APPLIED',
      entity_type: 'ADJUSTMENT',
      entity_id: adjRef,
      details: { delta_qty: adj.delta_qty, kind: adj.kind },
    });

    return { ok: true, status: 'APPLIED' };
  })();
}

export function rejectAdjustment(
  db: Database.Database,
  adjRef: string,
  params: { reasonCode: string; note?: string },
  actor: { id: number; role: string; username: string }
): { ok: boolean; status: string } {
  return db.transaction(() => {
    const adj = db.prepare('SELECT * FROM inventory_adjustments WHERE adj_ref = ?').get(adjRef) as any;
    if (!adj) {
      throw new DomainError('NOT_FOUND', `Adjustment ${adjRef} not found`, {}, 404);
    }

    if (actor.username === adj.requested_by) {
      throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'Requester cannot reject their own adjustment', {}, 403);
    }

    transition('ADJUSTMENT', adj.status, 'reject');

    // If damage write off rejected: return from QUAR -> BIN
    if (adj.kind === 'DAMAGE_WRITE_OFF') {
      const lotId = adj.lot_id || `LOT-LEGACY-${adj.sku}`;
      postLedger(
        db,
        [
          {
            sku: adj.sku,
            lotId,
            qty: Math.abs(adj.delta_qty),
            from: 'QUAR',
            to: `BIN:${adj.bin_code}`,
            type: 'QUARANTINE_RELEASE',
            refType: 'ADJUSTMENT',
            refId: adjRef,
          },
        ],
        { id: String(actor.id) }
      );
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE inventory_adjustments
      SET status = 'REJECTED', reject_reason = ?, version = version + 1
      WHERE id = ?
    `).run(params.reasonCode, adj.id);

    audit(db, {
      actor,
      action: 'ADJUSTMENT_REJECTED',
      entity_type: 'ADJUSTMENT',
      entity_id: adjRef,
      details: { reason: params.reasonCode },
    });

    return { ok: true, status: 'REJECTED' };
  })();
}

export function flagDamageStock(
  db: Database.Database,
  params: { binCode: string; qty: number; note?: string },
  actor: { id: number; role: string; username: string }
): { ok: boolean; binCode: string; quarantinedQty: number } {
  return db.transaction(() => {
    assertBinFree(db, params.binCode);

    const inv = db.prepare('SELECT sku, qty, reserved_qty, lot_id FROM inventory WHERE bin_code = ?').get(params.binCode) as any;
    if (!inv || !inv.sku) {
      throw new DomainError('NOT_FOUND', `No stock found in bin ${params.binCode}`, {}, 404);
    }

    const available = inv.qty - inv.reserved_qty;
    if (params.qty <= 0 || params.qty > available) {
      throw new DomainError('NEGATIVE_BALANCE', `Quantity ${params.qty} exceeds available unreserved stock ${available}`, {}, 422);
    }

    const lotId = inv.lot_id || `LOT-LEGACY-${inv.sku}`;
    ensureLot(db, { lotId, sku: inv.sku });

    // Ledger move: BIN -> QUAR
    postLedger(
      db,
      [
        {
          sku: inv.sku,
          lotId,
          qty: params.qty,
          from: `BIN:${params.binCode}`,
          to: 'QUAR',
          type: 'QUARANTINE',
          refType: 'DAMAGE_FLAG',
          refId: params.binCode,
        },
      ],
      { id: String(actor.id) }
    );

    // Create adjustment request
    const prod = db.prepare('SELECT price_paise FROM products WHERE sku = ?').get(inv.sku) as any;
    const valuePaise = params.qty * (prod?.price_paise || 10000);
    const adjRef = nextRef(db, 'ADJ');
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO inventory_adjustments (
        adj_ref, kind, status, bin_code, sku, lot_id, delta_qty, value_paise,
        reason_code, note, requested_by, requested_at
      ) VALUES (
        ?, 'DAMAGE_WRITE_OFF', 'PENDING_MANAGER', ?, ?, ?, ?, ?,
        'DAMAGED', ?, ?, ?
      )
    `).run(adjRef, params.binCode, inv.sku, lotId, -params.qty, valuePaise, params.note || null, actor.username, nowIso);

    audit(db, {
      actor,
      action: 'DAMAGE_FLAGGED',
      entity_type: 'INVENTORY',
      entity_id: params.binCode,
      details: { sku: inv.sku, qty: params.qty, adj_ref: adjRef },
    });

    return { ok: true, binCode: params.binCode, quarantinedQty: params.qty };
  })();
}

export function requestRelocationTask(
  db: Database.Database,
  params: { fromBin: string; toBin: string; sku: string; qty: number; reasonCode: string },
  actor: { id: number; role: string; username: string }
): { ok: boolean; taskRef: string } {
  return db.transaction(() => {
    assertBinFree(db, params.toBin);

    // Check if dest bin already has another SKU
    const destInv = db.prepare('SELECT sku, qty FROM inventory WHERE bin_code = ?').get(params.toBin) as any;
    if (destInv && destInv.sku && destInv.sku.toUpperCase() !== params.sku.toUpperCase() && destInv.qty > 0) {
      throw new DomainError('LOT_MIX', `Destination bin ${params.toBin} already holds SKU ${destInv.sku}`, {}, 422);
    }

    const taskRef = createFloorTask(db, {
      type: 'RELOCATE',
      binCode: params.fromBin,
      destBinCode: params.toBin,
      sku: params.sku,
      qty: params.qty,
      priority: 50,
      createdBy: actor.username,
      payload: { reason_code: params.reasonCode },
    });

    return { ok: true, taskRef };
  })();
}

export function executeRelocationTask(
  db: Database.Database,
  taskRef: string,
  params: { fromScan: string; itemScan: string; toScan: string },
  actor: { id: number; role: string; username: string }
): { ok: boolean; status: string } {
  return db.transaction(() => {
    const task = db.prepare('SELECT * FROM floor_tasks WHERE task_ref = ?').get(taskRef) as any;
    if (!task || task.type !== 'RELOCATE') {
      throw new DomainError('NOT_FOUND', `Relocation task ${taskRef} not found`, {}, 404);
    }

    if (task.assigned_to !== actor.username) {
      throw new DomainError('MISSION_NOT_OWNED', 'You do not own this relocation task', {}, 403);
    }

    if (params.fromScan.trim().toUpperCase() !== task.bin_code.toUpperCase()) {
      throw new DomainError('SCAN_WRONG_BIN', `From bin scan '${params.fromScan}' does not match expected '${task.bin_code}'`, {}, 422);
    }

    if (params.itemScan.trim().toUpperCase() !== task.sku.toUpperCase()) {
      throw new DomainError('SCAN_WRONG_ITEM', `Item scan '${params.itemScan}' does not match expected '${task.sku}'`, {}, 422);
    }

    if (params.toScan.trim().toUpperCase() !== task.dest_bin_code.toUpperCase()) {
      throw new DomainError('SCAN_WRONG_BIN', `To bin scan '${params.toScan}' does not match expected '${task.dest_bin_code}'`, {}, 422);
    }

    assertBinFree(db, task.dest_bin_code);

    // Get lot from fromBin
    const lotRow = db.prepare(`
      SELECT lot_id FROM location_balances
      WHERE location_key = ? AND sku = ? AND qty > 0
      ORDER BY qty DESC LIMIT 1
    `).get(`BIN:${task.bin_code}`, task.sku) as { lot_id: string } | undefined;

    const lotId = lotRow?.lot_id || `LOT-LEGACY-${task.sku}`;
    ensureLot(db, { lotId, sku: task.sku });

    // Ledger move: BIN -> BIN
    postLedger(
      db,
      [
        {
          sku: task.sku,
          lotId,
          qty: task.qty,
          from: `BIN:${task.bin_code}`,
          to: `BIN:${task.dest_bin_code}`,
          type: 'RELOCATE',
          refType: 'FLOOR_TASK',
          refId: taskRef,
        },
      ],
      { id: String(actor.id) }
    );

    const nowIso = new Date().toISOString();
    db.prepare(`UPDATE floor_tasks SET status = 'DONE', completed_at = ? WHERE id = ?`).run(nowIso, task.id);

    audit(db, {
      actor,
      action: 'RELOCATION_EXECUTED',
      entity_type: 'FLOOR_TASK',
      entity_id: taskRef,
      details: { from_bin: task.bin_code, to_bin: task.dest_bin_code, qty: task.qty },
    });

    return { ok: true, status: 'DONE' };
  })();
}

export function cancelOrderBeforePick(
  db: Database.Database,
  orderRef: string,
  params: { reasonCode?: string; note?: string },
  actor: { id: number; role: string; username: string }
): { ok: boolean; status: string } {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(orderRef) as any;
    if (!order) {
      throw new DomainError('NOT_FOUND', `Order ${orderRef} not found`, {}, 404);
    }

    if (order.status === 'CANCELLED') {
      return { ok: true, status: 'CANCELLED' };
    }

    // Check if stock is already in totes
    const pickedInTotes = db.prepare(`
      SELECT 1 FROM location_balances
      WHERE location_key GLOB 'TOTE:*' AND order_ref = ? AND qty > 0
      LIMIT 1
    `).get(orderRef);

    if (pickedInTotes) {
      throw new DomainError('ORDER_CANCEL_NEEDS_PUTBACK', 'Cannot cancel order with stock already picked into totes', {}, 409);
    }

    transition('ORDER', order.status, 'cancel');

    const nowIso = new Date().toISOString();

    // Release reservations
    db.prepare(`
      UPDATE reservations
      SET released_qty = qty - consumed_qty, status = 'RELEASED', updated_at = ?
      WHERE order_id = ? AND status = 'HELD'
    `).run(nowIso, order.id);

    // Cancel active missions
    db.prepare(`
      UPDATE missions
      SET status = 'CANCELLED'
      WHERE order_id = ? AND status IN ('QUEUED', 'ASSIGNED', 'CLAIMED')
    `).run(order.id);

    // Free tote if any
    db.prepare(`
      UPDATE totes
      SET status = 'FREE', mission_ref = NULL, order_ref = NULL, updated_at = ?
      WHERE order_ref = ?
    `).run(nowIso, orderRef);

    // Cancel order
    db.prepare(`
      UPDATE orders
      SET status = 'CANCELLED', cancelled_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(params.reasonCode || 'USER_CANCELLED', nowIso, order.id);

    appendOrderEvent(db, {
      orderRef,
      event: 'order.cancelled',
      actor,
      payload: { reason_code: params.reasonCode, note: params.note },
    });

    audit(db, {
      actor,
      action: 'ORDER_CANCELLED',
      entity_type: 'ORDER',
      entity_id: orderRef,
      details: { reason: params.reasonCode },
    });

    return { ok: true, status: 'CANCELLED' };
  })();
}
