// Aircraft performance table.
// APPROXIMATION: values are typical public figures (manufacturer airport-planning
// documents, EUROCONTROL Aircraft Performance Database typical values). They are
// representative, not certified data for any specific airframe/weight.
//   wake: ICAO category (L/M/H/J=Super)
//   vr: rotation IAS, vapp: final approach IAS (kt), vmin: min clean IAS
//   climb: [fpm below FL100, FL100–FL240, above FL240]
//   desc: typical idle descent rate (fpm), mach: cruise Mach, ceil: service ceiling (FL)
//   cruiseIas: climb/descent IAS above FL100, accel: kt/s
export const PERF = {
  A20N: { name: 'Airbus A320neo', wake: 'M', vr: 145, vapp: 133, vmin: 200, climb: [2600, 2100, 1300], desc: 2200, mach: 0.78, ceil: 390, cruiseIas: 290, accel: 1.4 },
  A320: { name: 'Airbus A320', wake: 'M', vr: 145, vapp: 135, vmin: 200, climb: [2500, 2000, 1200], desc: 2200, mach: 0.78, ceil: 390, cruiseIas: 290, accel: 1.4 },
  A321: { name: 'Airbus A321', wake: 'M', vr: 150, vapp: 140, vmin: 210, climb: [2300, 1900, 1100], desc: 2300, mach: 0.78, ceil: 390, cruiseIas: 300, accel: 1.3 },
  A21N: { name: 'Airbus A321neo', wake: 'M', vr: 150, vapp: 138, vmin: 210, climb: [2500, 2000, 1200], desc: 2300, mach: 0.78, ceil: 390, cruiseIas: 300, accel: 1.3 },
  B738: { name: 'Boeing 737-800', wake: 'M', vr: 150, vapp: 145, vmin: 210, climb: [2500, 2000, 1200], desc: 2300, mach: 0.785, ceil: 410, cruiseIas: 290, accel: 1.4 },
  B38M: { name: 'Boeing 737 MAX 8', wake: 'M', vr: 150, vapp: 145, vmin: 210, climb: [2600, 2100, 1300], desc: 2300, mach: 0.79, ceil: 410, cruiseIas: 290, accel: 1.4 },
  B763: { name: 'Boeing 767-300ER', wake: 'H', vr: 155, vapp: 142, vmin: 215, climb: [2400, 1900, 1100], desc: 2400, mach: 0.80, ceil: 430, cruiseIas: 300, accel: 1.2 },
  B772: { name: 'Boeing 777-200', wake: 'H', vr: 160, vapp: 145, vmin: 220, climb: [2200, 1800, 1000], desc: 2400, mach: 0.84, ceil: 430, cruiseIas: 310, accel: 1.1 },
  B77W: { name: 'Boeing 777-300ER', wake: 'H', vr: 165, vapp: 152, vmin: 225, climb: [2100, 1700, 1000], desc: 2400, mach: 0.84, ceil: 430, cruiseIas: 310, accel: 1.0 },
  B77L: { name: 'Boeing 777F', wake: 'H', vr: 165, vapp: 150, vmin: 225, climb: [1900, 1500, 900], desc: 2400, mach: 0.84, ceil: 430, cruiseIas: 310, accel: 1.0 },
  B788: { name: 'Boeing 787-8', wake: 'H', vr: 150, vapp: 140, vmin: 215, climb: [2600, 2100, 1300], desc: 2400, mach: 0.85, ceil: 430, cruiseIas: 310, accel: 1.2 },
  B789: { name: 'Boeing 787-9', wake: 'H', vr: 155, vapp: 145, vmin: 220, climb: [2500, 2000, 1200], desc: 2400, mach: 0.85, ceil: 430, cruiseIas: 310, accel: 1.2 },
  B78X: { name: 'Boeing 787-10', wake: 'H', vr: 160, vapp: 150, vmin: 225, climb: [2300, 1900, 1100], desc: 2400, mach: 0.85, ceil: 410, cruiseIas: 310, accel: 1.1 },
  B744: { name: 'Boeing 747-400', wake: 'H', vr: 165, vapp: 155, vmin: 230, climb: [2000, 1600, 900], desc: 2500, mach: 0.85, ceil: 450, cruiseIas: 320, accel: 1.0 },
  B748: { name: 'Boeing 747-8', wake: 'H', vr: 165, vapp: 158, vmin: 230, climb: [2000, 1600, 900], desc: 2500, mach: 0.855, ceil: 430, cruiseIas: 320, accel: 1.0 },
  A332: { name: 'Airbus A330-200', wake: 'H', vr: 150, vapp: 138, vmin: 215, climb: [2300, 1900, 1100], desc: 2400, mach: 0.82, ceil: 410, cruiseIas: 300, accel: 1.2 },
  A333: { name: 'Airbus A330-300', wake: 'H', vr: 155, vapp: 140, vmin: 215, climb: [2200, 1800, 1000], desc: 2400, mach: 0.82, ceil: 410, cruiseIas: 300, accel: 1.2 },
  A359: { name: 'Airbus A350-900', wake: 'H', vr: 150, vapp: 140, vmin: 215, climb: [2500, 2000, 1200], desc: 2400, mach: 0.85, ceil: 430, cruiseIas: 310, accel: 1.2 },
  A35K: { name: 'Airbus A350-1000', wake: 'H', vr: 155, vapp: 145, vmin: 220, climb: [2400, 1900, 1100], desc: 2400, mach: 0.85, ceil: 430, cruiseIas: 310, accel: 1.1 },
  A388: { name: 'Airbus A380-800', wake: 'J', vr: 155, vapp: 140, vmin: 225, climb: [1900, 1500, 900], desc: 2400, mach: 0.85, ceil: 430, cruiseIas: 310, accel: 0.9 },
  E190: { name: 'Embraer 190', wake: 'M', vr: 135, vapp: 128, vmin: 200, climb: [2600, 2000, 1200], desc: 2200, mach: 0.78, ceil: 410, cruiseIas: 280, accel: 1.5 },
  E170: { name: 'Embraer 170', wake: 'M', vr: 130, vapp: 125, vmin: 200, climb: [2600, 2000, 1200], desc: 2200, mach: 0.78, ceil: 410, cruiseIas: 280, accel: 1.5 },
  CRJ7: { name: 'Bombardier CRJ700', wake: 'M', vr: 135, vapp: 135, vmin: 200, climb: [2600, 2000, 1200], desc: 2200, mach: 0.78, ceil: 410, cruiseIas: 280, accel: 1.5 },
  DH8D: { name: 'De Havilland Dash 8-400', wake: 'M', vr: 115, vapp: 120, vmin: 170, climb: [2000, 1500, 900], desc: 1800, mach: 0.60, ceil: 270, cruiseIas: 240, accel: 1.5, tas: 350 },
  AT76: { name: 'ATR 72-600', wake: 'M', vr: 110, vapp: 115, vmin: 160, climb: [1700, 1300, 800], desc: 1600, mach: 0.50, ceil: 250, cruiseIas: 210, accel: 1.5, tas: 275 },
  B39M: { name: 'Boeing 737 MAX 9', wake: 'M', vr: 155, vapp: 148, vmin: 215, climb: [2400, 1900, 1200], desc: 2300, mach: 0.79, ceil: 410, cruiseIas: 290, accel: 1.3 },
  B739: { name: 'Boeing 737-900', wake: 'M', vr: 155, vapp: 148, vmin: 215, climb: [2300, 1900, 1100], desc: 2300, mach: 0.785, ceil: 410, cruiseIas: 290, accel: 1.3 },
  B737: { name: 'Boeing 737-700', wake: 'M', vr: 140, vapp: 135, vmin: 200, climb: [2700, 2200, 1300], desc: 2200, mach: 0.785, ceil: 410, cruiseIas: 290, accel: 1.5 },
};
export const DEFAULT_TYPE = 'A320';
export const perf = (t) => PERF[t] || PERF[DEFAULT_TYPE];

// Wake turbulence radar separation on final (NM), ICAO PANS-ATM 8.7.3.4
// [leader][follower]; 0 => only radar minimum applies.
export const WAKE_NM = {
  J: { J: 0, H: 6, M: 7, L: 8 },
  H: { J: 0, H: 4, M: 5, L: 6 },
  M: { J: 0, H: 0, M: 0, L: 5 },
  L: { J: 0, H: 0, M: 0, L: 0 },
};

// Standard atmosphere conversions (sufficient for display & kinematics)
export function tasFromIas(ias, altFt) {
  // TAS ≈ EAS / sqrt(sigma); simplified ISA density ratio
  const sigma = Math.pow(1 - 6.8756e-6 * Math.min(altFt, 36089), 4.2559) * (altFt > 36089 ? Math.exp(-(altFt - 36089) / 20806) : 1);
  return ias / Math.sqrt(sigma);
}
export function speedOfSound(altFt) {
  const t = altFt < 36089 ? 288.15 - 0.0019812 * altFt : 216.65;
  return 38.967854 * Math.sqrt(t); // kt
}
export const machToTas = (m, alt) => m * speedOfSound(alt);
export function iasFromMach(m, alt) {
  // invert tasFromIas numerically (few iterations)
  const tas = machToTas(m, alt);
  let ias = tas * 0.6;
  for (let i = 0; i < 6; i++) ias *= tas / tasFromIas(ias, alt);
  return ias;
}
