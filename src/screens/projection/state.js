// UI state shared by the Projeção sub-tabs: the chosen scenario (Cenários picks it, Real × plano compares against it)
// and the "what if I spend" slider value.
export const ui = { scenario: "real", chosen: null };

export const MIN = 5000; // the slider's floor
export const STEP = 1000; // the "each R$ X a month" rule of thumb
