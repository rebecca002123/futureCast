// Live phase status helpers shared by the main screen and the AR view.

export function countdown(ms) {
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Next milestone for an observer's local circumstances at wall-clock `now`.
export function phaseInfo(result, now) {
  if (!result || !result.visible) return null;
  const t = now.getTime();
  if (t < result.partialStart.getTime()) {
    return {
      label: 'Partial eclipse begins',
      at: result.partialStart,
      note: `starts in ${countdown(result.partialStart.getTime() - t)}`,
      live: false,
    };
  }
  if (result.isTotal && t < result.total.start.getTime()) {
    return {
      label: 'TOTALITY begins',
      at: result.total.start,
      note: `in ${countdown(result.total.start.getTime() - t)}`,
      live: true,
    };
  }
  if (result.isTotal && t < result.total.end.getTime()) {
    return {
      label: 'TOTALITY NOW',
      at: result.total.end,
      note: `ends in ${countdown(result.total.end.getTime() - t)}`,
      live: true,
    };
  }
  if (t < result.maximum.getTime()) {
    return {
      label: 'Maximum eclipse',
      at: result.maximum,
      note: `in ${countdown(result.maximum.getTime() - t)}`,
      live: true,
    };
  }
  if (t < result.partialEnd.getTime()) {
    return {
      label: 'Partial eclipse ends',
      at: result.partialEnd,
      note: `in ${countdown(result.partialEnd.getTime() - t)}`,
      live: true,
    };
  }
  return {
    label: 'Eclipse is over here',
    at: result.partialEnd,
    note: 'see you next time',
    live: false,
  };
}
