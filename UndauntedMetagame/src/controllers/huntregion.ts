export type HuntRegion = 'main' | 'aus' | 'ger' | 'us';
export type RegionChoice = HuntRegion | 'mixed';
let readPreference: (userId: string) => HuntRegion = () => 'main';
export function SetRegionReader(reader: typeof readPreference) { readPreference = reader; }
export function PlayerRegion(userId: string): HuntRegion { return readPreference(userId); }
export function PartyRegion(players: string[]): RegionChoice {
    const regions = new Set(players.map(PlayerRegion));
    return regions.size > 1 ? 'mixed' : regions.values().next().value ?? 'main';
}
export function RegionQueueKey(hunt: string, region: HuntRegion) { return region === 'main' ? hunt : `${hunt}:${region}`; }
