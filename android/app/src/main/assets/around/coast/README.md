# Around city coastlines

One file per gazetteer city (`<city slug>.json`): land, water (lakes and river areas) and shore
lines inside a box 60 km either side of the city centroid. YARD Around draws them over the bundled
Natural Earth globe from zoom 9.6, so the covered cities show real lagoons, islands and rivers at
city and neighbourhood zoom even when OpenFreeMap street tiles can't load.

Shape: `{ v: 1, slug, bbox: [west, south, east, north], source, land, water, shore }`, where `land`
and `water` are lists of polygons (rings of `[lng, lat]`, 5 decimals) and `shore` is a list of lines.

## Source and licence

Derived from **© OpenStreetMap contributors**, via the npm packages `@geo-maps/earth-lands-10m`,
`@geo-maps/earth-lakes-10m` and `@geo-maps/earth-rivers-10m` 0.6.0 (Simone Primarosa). The data is
licensed under the Open Database License (ODbL 1.0): https://opendatacommons.org/licenses/odbl/1.0/
These extracts are a derived database and are offered under the same licence. The map shows
"© OpenStreetMap contributors" whenever this layer is in view.

## How the files were made

Each source polygon whose bounding box meets a city's box was clipped to the box
(Sutherland–Hodgman), smoothed with two rounds of Chaikin corner cutting (the source is stepped;
points on the box edge stay fixed), simplified with Douglas–Peucker at 0.0002° (about 22 m), rounded
to 5 decimals; water smaller than about 0.3 km² is left out, so ponds don't speckle the map — the shore lines are the same
rings clipped as lines, so a box edge is never drawn as a shore. The packages were downloaded with
`npm pack --ignore-scripts` and never installed into this project. To add a city, rebuild with the
same steps for its centroid and add its slug to the gazetteer.
