// Layout of the AetherCorp outpost. Positions are in metres on the site plan (x east, z south).
export const SITE = { name: 'Outpost K-7', region: 'Kerguelen plateau' }

export const NODE_INFO = {
  'sentinel-hero': { label: 'Control hut', pos: [0, 0, 6], simulated: false },
  'sentinel-01': { label: 'North gate', pos: [-2, 0, -17], simulated: true },
  'sentinel-02': { label: 'Gas manifold', pos: [12, 0, -4], simulated: true },
  'sentinel-03': { label: 'Turbine hall', pos: [-11, 0, -2], simulated: true },
  'sentinel-04': { label: 'Battery store', pos: [9, 0, 11], simulated: true },
}

export const STRUCTURES = [
  { kind: 'box', pos: [-11, 0, -6], size: [9, 4, 6], windows: 4 },   // turbine hall
  { kind: 'tank', pos: [13, 0, -8], r: 2.2, h: 5 },          // gas tanks
  { kind: 'tank', pos: [16.5, 0, -4], r: 1.6, h: 4 },
  { kind: 'box', pos: [7, 0, 14], size: [3, 2.5, 5] },       // battery containers
  { kind: 'box', pos: [10.5, 0, 14], size: [3, 2.5, 5] },
  { kind: 'box', pos: [0, 0, 9], size: [4, 2.6, 3], windows: 2 },   // control hut
  { kind: 'mast', pos: [-4, 0, 2], h: 12 },                  // comms mast
]

export const FENCE = [[-22, -21], [21, -21], [23, 18], [-20, 19]]

export const nodeLabel = (id) => NODE_INFO[id]?.label ?? id
