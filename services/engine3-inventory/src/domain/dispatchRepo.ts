import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { DomainError, transition } from '@dark-storage/shared';
import { audit } from './audit.js';
import { appendOrderEvent } from '../audit/appendAudit.js';
import { postLedger } from '../ledger/postLedger.js';
import { demoOtpStore } from './packingRepo.js';

export interface DispatchQueueItem {
  order_ref: string;
  customer_ref: string | null;
  priority: string;
  slot_code: string;
  packed_at: string | null;
  sla_due_at: string | null;
  locked: boolean;
  attempts: number;
}

export function getDispatchQueue(db: Database.Database): { items: DispatchQueueItem[] } {
  const rows = db.prepare(`
    SELECT o.ref as order_ref, o.customer_ref, o.priority, o.packed_at, o.sla_due_at,
           dh.slot_code, dh.locked, dh.attempts
    FROM orders o
    JOIN dispatch_handovers dh ON o.ref = dh.order_ref
    WHERE o.status = 'PACKED'
    ORDER BY o.priority = 'URGENT' DESC, o.priority = 'HIGH' DESC, o.packed_at ASC
  `).all() as Array<{
    order_ref: string;
    customer_ref: string | null;
    priority: string;
    slot_code: string;
    packed_at: string | null;
    sla_due_at: string | null;
    locked: number;
    attempts: number;
  }>;

  return {
    items: rows.map((r) => ({
      order_ref: r.order_ref,
      customer_ref: r.customer_ref,
      priority: r.priority,
      slot_code: r.slot_code,
      packed_at: r.packed_at,
      sla_due_at: r.sla_due_at,
      locked: r.locked === 1,
      attempts: r.attempts,
    })),
  };
}

export function handoverDispatch(
  db: Database.Database,
  orderRef: string,
  params: { slotScan: string; otp: string; riderName?: string },
  actor: { id: number; role: string; username: string }
): { ok: boolean; orderRef: string; status: string } {
  const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(orderRef) as any;
  if (!order) {
    throw new DomainError('NOT_FOUND', `Order ${orderRef} not found`, {}, 404);
  }

  if (order.status !== 'PACKED') {
    throw new DomainError('STATE_CONFLICT', `Order is in status ${order.status}, expected PACKED`, {}, 409);
  }

  const handover = db.prepare('SELECT * FROM dispatch_handovers WHERE order_ref = ?').get(orderRef) as any;
  if (!handover) {
    throw new DomainError('NOT_FOUND', `No dispatch handover found for order ${orderRef}`, {}, 404);
  }

  const cleanSlot = params.slotScan.trim().toUpperCase();
  if (cleanSlot !== handover.slot_code.toUpperCase()) {
    throw new DomainError('SLOT_MISMATCH', `Scanned slot '${cleanSlot}' does not match assigned slot '${handover.slot_code}'`, {}, 422);
  }

  if (handover.locked === 1) {
    throw new DomainError('OTP_LOCKED', 'Dispatch is locked due to too many failed OTP attempts. Manager must regenerate OTP.', {}, 409);
  }

  const now = Date.now();
  if (new Date(handover.otp_expires_at).getTime() < now) {
    throw new DomainError('OTP_INVALID', 'OTP has expired. Manager must regenerate OTP.', {}, 422);
  }

  const cleanOtp = params.otp.trim();
  const computedHash = crypto.createHash('sha256').update(cleanOtp + orderRef).digest('hex');

  if (computedHash !== handover.otp_hash) {
    const newAttempts = handover.attempts + 1;
    const maxAttempts = 3;
    const isLocked = newAttempts >= maxAttempts ? 1 : 0;

    db.prepare(`
      UPDATE dispatch_handovers
      SET attempts = ?, locked = ?
      WHERE id = ?
    `).run(newAttempts, isLocked, handover.id);

    try {
      appendOrderEvent(db, {
        orderRef,
        event: 'dispatch.otp_failed',
        actor,
        payload: { attempts: newAttempts, locked: isLocked === 1 },
      });
    } catch (e) {
      // ignore
    }

    if (isLocked) {
      throw new DomainError('OTP_LOCKED', 'Maximum OTP attempts exceeded. Dispatch locked.', { attempts: newAttempts }, 409);
    }

    throw new DomainError('OTP_INVALID', 'Invalid OTP', { attemptsRemaining: maxAttempts - newAttempts }, 422);
  }

  return db.transaction(() => {
    // OTP match!
    const nowIso = new Date().toISOString();

    // Ledger: move units from DISP:slot to SHIPPED
    const dispBalances = db.prepare(`
      SELECT sku, lot_id, qty
      FROM location_balances
      WHERE location_key = ? AND qty > 0
    `).all(`DISP:${handover.slot_code}`) as Array<{ sku: string; lot_id: string; qty: number }>;

    if (dispBalances.length > 0) {
      postLedger(
        db,
        dispBalances.map((b) => ({
          sku: b.sku,
          lotId: b.lot_id,
          qty: b.qty,
          from: `DISP:${handover.slot_code}`,
          to: 'SHIPPED',
          type: 'HANDOVER',
          orderRef,
          refType: 'ORDER',
          refId: orderRef,
        })),
        { id: String(actor.id) }
      );
    }

    // Free dispatch slot
    db.prepare(`UPDATE dispatch_slots SET status = 'FREE', order_ref = NULL WHERE slot_code = ?`).run(handover.slot_code);

    // Order handover transition -> DISPATCHED
    transition('ORDER', order.status, 'handover');
    db.prepare(`
      UPDATE orders
      SET status = 'DISPATCHED', dispatched_at = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nowIso, nowIso, nowIso, order.id);

    // Update handover
    db.prepare(`
      UPDATE dispatch_handovers
      SET rider_name = ?, handed_by = ?, handed_at = ?
      WHERE id = ?
    `).run(params.riderName || null, actor.username, nowIso, handover.id);

    audit(db, {
      actor,
      action: 'ORDER_DISPATCHED',
      entity_type: 'ORDER',
      entity_id: orderRef,
      details: { slot_code: handover.slot_code, rider: params.riderName },
    });

    appendOrderEvent(db, {
      orderRef,
      event: 'dispatch.completed',
      actor,
      payload: { slot_code: handover.slot_code, rider: params.riderName },
    });

    return { ok: true, orderRef, status: 'DISPATCHED' };
  })();
}

export function regenOtp(
  db: Database.Database,
  orderRef: string,
  reasonCode: string,
  actor: { id: number; role: string; username: string }
): { ok: boolean } {
  if (!reasonCode || !reasonCode.trim()) {
    throw new DomainError('REASON_REQUIRED', 'Reason code is required to regenerate OTP', {}, 400);
  }

  return db.transaction(() => {
    const handover = db.prepare('SELECT * FROM dispatch_handovers WHERE order_ref = ?').get(orderRef) as any;
    if (!handover) {
      throw new DomainError('NOT_FOUND', `Dispatch handover record not found for order ${orderRef}`, {}, 404);
    }

    const newOtp = String(crypto.randomInt(1000, 10000));
    const newHash = crypto.createHash('sha256').update(newOtp + orderRef).digest('hex');
    const newExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.prepare(`
      UPDATE dispatch_handovers
      SET otp_hash = ?, otp_expires_at = ?, attempts = 0, locked = 0
      WHERE id = ?
    `).run(newHash, newExpiresAt, handover.id);

    demoOtpStore.set(orderRef, newOtp);

    audit(db, {
      actor,
      action: 'OTP_REGENERATED',
      entity_type: 'ORDER',
      entity_id: orderRef,
      details: { reason_code: reasonCode },
    });

    appendOrderEvent(db, {
      orderRef,
      event: 'dispatch.otp_regenerated',
      actor,
      payload: { reason_code: reasonCode },
    });

    return { ok: true };
  })();
}

export function getDemoOtp(db: Database.Database, orderRef: string): { ok: boolean; orderRef: string; otp: string } {
  const handover = db.prepare('SELECT * FROM dispatch_handovers WHERE order_ref = ?').get(orderRef) as any;
  if (!handover) {
    throw new DomainError('NOT_FOUND', `Order ${orderRef} not found in dispatch`, {}, 404);
  }

  let otp = demoOtpStore.get(orderRef);
  if (!otp) {
    // Regenerate deterministic demo OTP e.g. "1234"
    otp = '1234';
    const newHash = crypto.createHash('sha256').update(otp + orderRef).digest('hex');
    const newExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(`
      UPDATE dispatch_handovers
      SET otp_hash = ?, otp_expires_at = ?, attempts = 0, locked = 0
      WHERE id = ?
    `).run(newHash, newExpiresAt, handover.id);
    demoOtpStore.set(orderRef, otp);
  }

  return { ok: true, orderRef, otp };
}
