import { FeedEvent } from '../../stores/realtimeStore.js';

export type EventCategory = 'all' | 'orders' | 'missions' | 'picks' | 'inventory' | 'exceptions';

export function getEventCategory(eventType: string): EventCategory {
  if (
    eventType.startsWith('order.') ||
    eventType === 'reservation.changed'
  ) {
    return 'orders';
  }
  if (eventType.startsWith('mission.')) {
    return 'missions';
  }
  if (eventType === 'pick.confirmed') {
    return 'picks';
  }
  if (
    eventType.startsWith('inventory.') ||
    eventType.startsWith('bin.') ||
    eventType.startsWith('receipt.') ||
    eventType.startsWith('putaway.')
  ) {
    return 'inventory';
  }
  if (eventType.startsWith('exception.')) {
    return 'exceptions';
  }
  return 'all';
}

export function formatEventSummary(event: FeedEvent): string {
  const data = event.data || {};
  const entityId = event.entity_id || '';

  switch (event.event_type) {
    case 'pick.confirmed': {
      const qty = data.picked_qty ?? data.qty ?? '';
      const target = data.stop_ref ?? data.mission_ref ?? entityId;
      if (qty !== '') {
        return target ? `Picked ${qty} on ${target}` : `Picked ${qty}`;
      }
      return target ? `Pick confirmed on ${target}` : 'Pick confirmed';
    }

    case 'inventory.changed': {
      if (Array.isArray(data.bins) && data.bins.length > 0) {
        const bins = data.bins.map(String);
        if (bins.length <= 3) {
          return `Stock changed in ${bins.join(', ')}`;
        }
        const firstThree = bins.slice(0, 3).join(', ');
        const remaining = bins.length - 3;
        return `Stock changed in ${firstThree} +${remaining}`;
      }
      return entityId ? `Stock changed in ${entityId}` : 'Stock changed';
    }

    case 'order.created': {
      const ref = (data.ref as string) || (data.order_ref as string) || entityId;
      return ref ? `Order ${ref} created` : 'Order created';
    }

    case 'order.status_changed': {
      const ref = (data.ref as string) || (data.order_ref as string) || entityId;
      const status = data.status || '';
      return status ? `Order ${ref} → ${status}` : `Order ${ref} status updated`;
    }

    case 'order.completed': {
      const ref = (data.ref as string) || (data.order_ref as string) || entityId;
      return ref ? `Order ${ref} completed` : 'Order completed';
    }

    case 'reservation.changed': {
      const orderRef = (data.order_ref as string) || (data.ref as string) || entityId;
      return orderRef ? `Reservation changed for order ${orderRef}` : 'Reservation changed';
    }

    case 'mission.assigned': {
      const ref = (data.ref as string) || (data.mission_ref as string) || entityId;
      const picker = (data.picker_name as string) || (data.picker_id as string);
      return picker ? `Mission ${ref} assigned to ${picker}` : `Mission ${ref} assigned`;
    }

    case 'mission.reassigned': {
      const ref = (data.ref as string) || (data.mission_ref as string) || entityId;
      return `Mission ${ref} reassigned`;
    }

    case 'mission.started': {
      const ref = (data.ref as string) || (data.mission_ref as string) || entityId;
      return `Mission ${ref} started`;
    }

    case 'mission.completed': {
      const ref = (data.ref as string) || (data.mission_ref as string) || entityId;
      return `Mission ${ref} completed`;
    }

    case 'exception.opened': {
      const type = (data.type as string) || (data.exception_type as string) || entityId;
      return type ? `Exception opened: ${type}` : 'Exception opened';
    }

    case 'exception.resolved': {
      const resolution = (data.resolution as string) || entityId;
      return resolution ? `Exception resolved: ${resolution}` : 'Exception resolved';
    }

    case 'receipt.created': {
      const ref = (data.ref as string) || entityId;
      return ref ? `Receipt ${ref} created` : 'Receipt created';
    }

    case 'putaway.completed': {
      const sku = (data.sku as string) || entityId;
      return sku ? `Put-away completed for ${sku}` : 'Put-away completed';
    }

    case 'bin.status_changed': {
      const binCode = (data.bin_code as string) || entityId;
      const status = data.status || '';
      return status ? `Bin ${binCode} status → ${status}` : `Bin ${binCode} updated`;
    }

    default:
      return event.event_type;
  }
}

export function formatRelativeTime(isoString: string, nowMs: number): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const time = date.getTime();
  if (isNaN(time)) return '';

  const diffSec = Math.max(0, Math.floor((nowMs - time) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  return `${diffDays}d ago`;
}
