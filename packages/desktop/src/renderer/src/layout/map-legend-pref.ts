const KEY = "anur.map.legend";

/** Whether the map shows its legend: off unless the person turned it on in ⋯ (30.44). */
export function mapLegend(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setMapLegend(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Without storage the choice lasts until the map closes.
  }
}
