// UK town picker for "risk for my location". A bundled list keeps it
// offline-friendly and avoids both a location permission and a geocoding
// service — pick your town once and everything local is measured from there.

export const UK_TOWNS = [
  ['Aberdeen', 57.15, -2.09], ['Aberystwyth', 52.41, -4.08], ['Ayr', 55.46, -4.63],
  ['Bangor', 53.23, -4.13], ['Barnstaple', 51.08, -4.06], ['Barrow-in-Furness', 54.11, -3.23],
  ['Bath', 51.38, -2.36], ['Belfast', 54.6, -5.93], ['Birmingham', 52.48, -1.9],
  ['Blackpool', 53.82, -3.05], ['Bournemouth', 50.72, -1.88], ['Bradford', 53.8, -1.75],
  ['Brighton', 50.82, -0.14], ['Bristol', 51.45, -2.59], ['Cambridge', 52.21, 0.12],
  ['Canterbury', 51.28, 1.08], ['Cardiff', 51.48, -3.18], ['Carlisle', 54.89, -2.94],
  ['Chester', 53.19, -2.89], ['Colchester', 51.89, 0.9], ['Cork', 51.9, -8.47],
  ['Coventry', 52.41, -1.51], ['Derby', 52.92, -1.48], ['Derry', 54.997, -7.31],
  ['Doncaster', 53.52, -1.13], ['Dover', 51.13, 1.31], ['Dublin', 53.35, -6.26],
  ['Dumfries', 55.07, -3.61], ['Dundee', 56.46, -2.97], ['Durham', 54.78, -1.58],
  ['Eastbourne', 50.77, 0.28], ['Edinburgh', 55.95, -3.19], ['Exeter', 50.72, -3.53],
  ['Falmouth', 50.15, -5.07], ['Fort William', 56.82, -5.11], ['Galway', 53.27, -9.05],
  ['Glasgow', 55.86, -4.25], ['Gloucester', 51.86, -2.24], ['Great Yarmouth', 52.61, 1.73],
  ['Grimsby', 53.57, -0.08], ['Harrogate', 53.99, -1.54], ['Hastings', 50.85, 0.57],
  ['Hereford', 52.06, -2.72], ['Holyhead', 53.31, -4.63], ['Hull', 53.75, -0.34],
  ['Inverness', 57.48, -4.22], ['Ipswich', 52.06, 1.16], ['Kendal', 54.33, -2.75],
  ['Kirkwall', 58.98, -2.96], ['Lancaster', 54.05, -2.8], ['Leeds', 53.8, -1.55],
  ['Leicester', 52.64, -1.13], ['Lerwick', 60.15, -1.15], ['Limerick', 52.66, -8.63],
  ['Lincoln', 53.23, -0.54], ['Liverpool', 53.41, -2.98], ['Llandudno', 53.32, -3.83],
  ['London', 51.51, -0.13], ['Londonderry', 54.997, -7.31], ['Luton', 51.88, -0.42],
  ['Manchester', 53.48, -2.24], ['Middlesbrough', 54.57, -1.23], ['Milton Keynes', 52.04, -0.76],
  ['Newcastle', 54.98, -1.61], ['Newquay', 50.42, -5.07], ['Newport', 51.58, -3.0],
  ['Northampton', 52.24, -0.9], ['Norwich', 52.63, 1.3], ['Nottingham', 52.95, -1.15],
  ['Oban', 56.41, -5.47], ['Oxford', 51.75, -1.26], ['Penzance', 50.12, -5.54],
  ['Perth', 56.4, -3.43], ['Peterborough', 52.57, -0.24], ['Plymouth', 50.38, -4.14],
  ['Portsmouth', 50.8, -1.09], ['Preston', 53.76, -2.7], ['Reading', 51.45, -0.98],
  ['Salisbury', 51.07, -1.79], ['Scarborough', 54.28, -0.4], ['Sheffield', 53.38, -1.47],
  ['Shrewsbury', 52.71, -2.75], ['Southampton', 50.9, -1.4], ['Southend-on-Sea', 51.54, 0.71],
  ['St Andrews', 56.34, -2.8], ['St Davids', 51.88, -5.27], ['Stirling', 56.12, -3.94],
  ['Stoke-on-Trent', 53.0, -2.18], ['Stornoway', 58.21, -6.39], ['Sunderland', 54.91, -1.38],
  ['Swansea', 51.62, -3.94], ['Swindon', 51.56, -1.78], ['Taunton', 51.02, -3.1],
  ['Thurso', 58.59, -3.52], ['Truro', 50.26, -5.05], ['Ullapool', 57.9, -5.16],
  ['Wick', 58.44, -3.09], ['Winchester', 51.06, -1.31], ['Wolverhampton', 52.59, -2.13],
  ['Worcester', 52.19, -2.22], ['Wrexham', 53.05, -3.0], ['York', 53.96, -1.08],
].map(([name, lat, lon]) => ({ name, lat, lon }));

export function searchTowns(query, limit = 6) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const starts = [];
  const contains = [];
  for (const town of UK_TOWNS) {
    const name = town.name.toLowerCase();
    if (name.startsWith(q)) starts.push(town);
    else if (name.includes(q)) contains.push(town);
  }
  return [...starts, ...contains].slice(0, limit);
}
