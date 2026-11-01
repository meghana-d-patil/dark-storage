export function formatRef(prefix: string, n: number): string {
  const padded = n.toString().padStart(4, '0');
  return `${prefix}-${padded}`;
}

export function formatStopRef(missionRef: string, stopNo: number): string {
  const padded = stopNo.toString().padStart(2, '0');
  return `${missionRef}-S${padded}`;
}
