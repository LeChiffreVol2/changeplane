export function planSyntheticStops(stops, { startMinute = 480, serviceMinutes = 40 } = {}) {
  return [...stops]
    .sort((left, right) => left.heuristicPriority - right.heuristicPriority)
    .map((stop, index) => ({
      ...stop,
      scheduledMinute: startMinute + (index * serviceMinutes),
    }));
}
